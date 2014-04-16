#!/usr/bin/env python
'''
Runs a server that can optionally control a physical door model on Arduino.
'''

from datetime import datetime, timedelta
import json
import argparse
import os.path
import re
import sys
import threading

try:
    import serial
except ImportError:
    pass

import doors
import dss

cli = argparse.ArgumentParser("Run a server that can control and monitor a door model")
cli.add_argument('-p', '--port', type=int, default=8000, help="Alternative HTTP port")
cli.add_argument('-d', '--device', help="Arduino serial device name")
cliargs = cli.parse_args()

revolver = doors.RevolvingDoor(16, 3)
lock = threading.RLock()
turns_per_sec = 0.2
server_start = datetime.now()
start = datetime.now() # when scenario started
steps = 0 # steps taken so far in this scenario
scenario = [0] # how many people arrive at each step
next_scenario = None
arduino = None
recording = 'recordings/' + datetime.now().strftime('%m%d%H-%M%S') + '.csv'
next_record = datetime.now() # when to record the next temp readings
alive = True

def connect_arduino(device):
    time_to_give_up = datetime.now() + timedelta(seconds=8)
    # Timeout shorter than min step time
    ardy = serial.Serial(device, 9600, timeout=0.2) # Resets arduino
    while True:
        # Wait for Arduino to boot
        if datetime.now() > time_to_give_up:
            raise IOError('Arduino not ready')
        line = ardy.readline()
        if line.startswith('Doors are ready'):
            break
    return ardy

if cliargs.device:
    print 'Connecting to Arduino...',
    sys.stdout.flush() # The partial line above may not appear otherwise
    arduino = connect_arduino(cliargs.device)
    print 'ready'

last_step = {
    'step': steps,
    'arrived': 0, # how many people arrived
    # door state before the step:
    'arriving': 0,
    'occupied': [False, False, False, False],
    'position': 0,
    'rotate': False # door rotated
}
temperature = None

def delay():
    next_step = start + timedelta(seconds=(steps / (turns_per_sec * revolver.granularity)))
    result = (next_step - datetime.now()).total_seconds()
    if result < 0:
        print start, steps, next_step, datetime.now()
        raise Exception('Delay not positive')
        # 15:27:00.556521 0 15:27:00.869021 15:27:05.847574
    return result

def advance():
    try:
        ''' Take a step in the running scenario, recording what happened. The data it stores uses
            these fields:

            -   step: Step number. The monitor should use this to check that it hasn't missed a step.
                This can periodically reset to zero, when switching to a new simulation.
            -   arrived: Number of people who arrived in this step.
            -   rotate: True or false depending on whether the door should rotate this step.

            The remaining fields allow a monitor to synchronize itself with the door by providing
            door state prior to the last step.
        '''
        global start
        global steps
        global scenario
        global next_scenario
        global last_step
        global temperature
        global next_record
        global alive
        if not alive:
            return
        with lock:
            last_step = {
                'arriving': revolver.arriving,
                'occupied': [c for c in revolver.occupied],
                'position': revolver.position
            }
            step = steps % len(scenario)
            if step == 0 and next_scenario:
                scenario = next_scenario
                next_scenario = None
                start = datetime.now()
                steps = 0
            last_step['step'] = steps
            last_step['arrived'] = scenario[step]
            revolver.arriving += scenario[step]
            last_step['rotate'] = revolver.step()
            steps += 1
        if arduino:
            report = arduino.readline()
            if temperature and not report:
                raise IOError('Arduino did not report temperature')
            with lock:
                temperature = temperature or []
            if report:
                try:
                    reportable = [
                            (datetime.now() - server_start).total_seconds(),
                            last_step['arriving']
                        ] + [int(t) for t in report.split()]
                except:
                    raise IOError('Arduino error: ' + report)
                command = '%d %d %d\n' % (
                    last_step['rotate'] and 1 or 0,
                    2,
                    int(delay() * 1000))
                arduino.write(command)
                if datetime.now() > next_record:
                    with lock:
                        temperature.append(reportable)
                    next_record += timedelta(seconds=15)
                if not os.path.exists(os.path.dirname(recording)):
                    os.makedirs(os.path.dirname(recording))
                with open(recording, 'a') as record:
                    record.write(','.join([str(v) for v in reportable]) + '\n')
        threading.Timer(delay(), advance).start()
    except Exception as e:
        alive = False
        raise e

_LiveSiteHandler = dss.LiveSiteHandler
class LiveSiteHandler(_LiveSiteHandler):

    next_duration = 0

    def _send_content(self, body, mime='application/json'):
        self.send_response(200)
        self.send_header('Content-Length', len(body))
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        ''' Reply with either the latest step instructions or serve from dss.

            When sending last step instructions, this includes the data recorded by the simulation
            thread and an additional delay parameter indicating how many milliseconds the monitor
            should wait before calling back for the next step.
        '''
        if not alive:
            self.send_error(500)
            self.end_headers()
            return
        try:
            if self.path == '/step':
                with lock:
                    reply = {k: last_step[k] for k in last_step}
                    reply['duration'] = int(delay() * 1000)
                    body = json.dumps(reply)
                self._send_content(body)
            elif self.path == '/temperature':
                if not arduino:
                    self.send_error(404)
                    self.end_headers()
                else:
                    if not temperature:
                        body = ''
                    else:
                        with lock:
                            body = '\n'.join([','.join([str(v) for v in r]) for r in temperature])
                    self._send_content(body, 'text/csv')
            else:
                _LiveSiteHandler.do_GET(self)
        except Exception as e:
            sys.stderr.write(str(e))
            self.send_error(500)

    def do_POST(self):
        ''' Set up a new run or have someone arrive '''
        if not alive:
            self.send_error(500)
            self.end_headers()
            return
        try:
            match = re.search(r'^/start/([a-z\-]+)', self.path)
            if match:
                global turns_per_sec
                global next_scenario
                length = int(self.headers['Content-Length'])
                posted = json.loads(self.rfile.read(length))
                numeric = re.compile(r'^\s*([0-9])')
                name = match.group(1)
                assert re.search(r'^[a-z\-]*$', name) # be safe, do not allow arbitrary path
                with open(os.path.join('scenarios', name + '.txt')) as f:
                    matches = [numeric.search(n) for n in f.readlines() if numeric.search(n)]
                with lock:
                    next_scenario = [int(m.group(1)) for m in matches]
                    assert len(scenario) >= 1
                    turns_per_sec = float(posted['turns_per_sec'])
                self.send_response(204)
            elif self.path == '/arrive':
                with lock:
                    revolver.arriving += 1
                self.send_response(204)
            else:
                self.send_error(403)
        except Exception as e:
            sys.stderr.write(str(e))
            self.send_error(500)
        self.end_headers()

    def log_request(*args):
        pass

dss.LiveSiteHandler = LiveSiteHandler
server_start = start = datetime.now() # reset since connecting to Arduino takes time
advance()
try:
    print 'Serving on http://localhost:%s' % (cliargs.port or 8000)
    dss.DeadSimpleSite('.').serve(port=cliargs.port)
except KeyboardInterrupt:
    print # for shells that echo ctrl+c without newline
finally:
    alive = False
