#!/usr/bin/env python
'''
Runs a server that can optionally control a physical door model on Arduino.
'''

from datetime import datetime, timedelta
import json
import argparse
import os.path
import re
import SocketServer
import sys
import threading
import traceback

try:
    import serial
except ImportError:
    pass

import doors
import dss
import stats

cli = argparse.ArgumentParser("Run a server that can control and monitor a door model")
cli.add_argument('-p', '--port', type=int, default=8000, help="Alternative HTTP port")
cli.add_argument('-d', '--device', help="Arduino serial device name")
cliargs = cli.parse_args()

lock = threading.RLock()
seconds_per_step = 0.625 # 6 rpm for a 16-granularity revolver
server_start = datetime.now()
steps = 1 # advances by one on each loop

model = {
    'revolver': doors.RevolvingDoor(16, 3),
    'swinger': doors.SwingingDoor(8, 7)
}
scenarios = {
    'revolver': {
        'started': 0,
        'arrivals': [0]
    },
    'swinger': {
        'started': 0,
        'arrivals': [0]
    }
}
next_scenarios = {
    'revolver': {
        'name': None,
        'arrivals': []
    },
    'swinger': {
        'name': None,
        'arrivals': []
    }
}

last_step = {
    'step': steps,
    'revolver': {
        'arrived': 0, # how many people arrived
        'steps': 0, # 0 or 1 depending on whether door rotated
        # door state before the step:
        'arriving': 0,
        'occupied': [False, False, False, False],
        'position': 0
    },
    'swinger': {
        'arrived': 0, # how many people arrived
        'angle': 0, # door angle at step end (radians)
        # door state before the step:
        'arriving': 0,
        'occupied': [False],
        'position': 0
    }
}

results_log = []
scenarios_log = []

def log_path(suffix='.csv'):
    return 'recordings/' + server_start.strftime('%m%d%H-%M%S') + suffix

arduino = None
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

def delay(shift=0):
    # Compute next step time based on number of steps to compensate for drift in timers
    next_step = server_start + timedelta(seconds=((steps + shift) * seconds_per_step))
    return (next_step - datetime.now()).total_seconds()

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
        global steps
        global next_record
        global alive
        if not alive:
            return
        if arduino:
            report = arduino.readline()
            if not report:
                raise IOError('Arduino did not report temperature')
        duration = delay()
        if duration <= 0:
            error_message = 'Illegal duration on step %s: %s\n' % (steps, duration)
            sys.stderr.write(error_message)
            with open(log_path('-errors.txt'), 'a') as log:
                log.write(error_message)
            steps += 1
            advance() # Skip to next step
            return
        with lock:
            last_step['step'] = steps
            for door_name in ['revolver', 'swinger']:
                door = model[door_name]
                step_info = last_step[door_name]

                step_info['arriving'] = door.arriving
                step_info['position'] = door.position
                step_info['occupied'] = [c for c in door.occupied]

                scenario = scenarios[door_name]
                step = (steps - scenario['started']) % len(scenario['arrivals'])
                if next_scenarios[door_name]['name'] and step == 0:
                    log_entry = [(datetime.now() - server_start).total_seconds(), 
                                 door_name,
                                 next_scenarios[door_name]['name']]
                    scenarios_log.append(log_entry)
                    with open(log_path('-scenarios.csv'), 'a') as log:
                        log.write(','.join([str(v) for v in log_entry]) + '\n')
                    scenario['arrivals'] = next_scenarios[door_name]['arrivals']
                    scenario['started'] = steps
                    next_scenarios[door_name]['name'] = None

                arrivals = scenario['arrivals'][step]
                step_info['arrived'] = arrivals
                door.arriving += arrivals
                turn_steps = door.step()
                if door_name == 'revolver':
                    step_info['rotate'] = turn_steps
                if door_name == 'swinger':
                    step_info['angle'] = door.angle()
            steps += 1
        reportable = [(datetime.now() - server_start).total_seconds()] \
                   + [last_step[n]['arrived'] for n in ['revolver', 'swinger']]
        if arduino:
            try:
                reportable += [int(t) for t in report.split()]
            except:
                traceback.print_exc()
                raise IOError('Arduino error: ' + report)
            with open(log_path(), 'a') as log:
                log.write(','.join([str(v) for v in reportable]) + '\n')
            command = '%d %d %d\n' % (
                last_step['revolver']['rotate'],
                int(last_step['swinger']['angle'] * 360 / (doors.pi * 2)),
                int(duration * 1000))
            arduino.write(command)
        else:
            reportable += [30, 33, 90, 96]
        with lock:
            results_log.append(reportable)
        threading.Timer(duration, advance).start()
    except Exception as e:
        traceback.print_exc()
        alive = False

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
            root, sub = re.search(r'^(?:/([^/]+)/?([^/]*))?', self.path).groups()
            if self.path == '/step':
                with lock:
                    reply = {k: last_step[k] for k in last_step}
                    # duration can be negative if call to this happens very close to a step boundary
                    duration = max(delay(-1), 0)
                    reply['duration'] = int(duration * 1000)
                    body = json.dumps(reply)
                self._send_content(body)
            elif root == 'results':
                if sub:
                    csv = ''
                    if sub.endswith('-scenarios.csv'):
                        with open('results/' + sub) as results_file:
                            csv = results_file.read()
                    else:
                        name, interval = re.search(r'^([^.]+)\.(\d*)', sub).groups()
                        with open('results/' + name + '.csv') as results_file:
                            if interval:
                                log = stats.from_csv(results_file.read())
                                csv = stats.to_csv(stats.summarize(log, int(interval)))
                            else:
                                csv = results_file.read()
                    self._send_content(csv, 'text/csv')
                else:
                    with lock:
                        csv = stats.to_csv(stats.summarize(results_log))
                    self._send_content(csv, 'text/csv')
            elif self.path == '/scenarios':
                with lock:
                    csv = stats.to_csv(scenarios_log)
                self._send_content(csv, 'text/csv')
            else:
                _LiveSiteHandler.do_GET(self)
        except Exception as e:
            traceback.print_exc()
            self.send_error(500)

    def do_POST(self):
        ''' Set up a new run or have someone arrive. Valid commands are:

            -   /start/[door]/[scenario]
            -   /arrive/[door]/

            Where door is either "revolver" or "swinger."
        '''
        if not alive:
            self.send_error(500)
            self.end_headers()
            return
        try:
            segments = re.search(r'^/([^/]+)/([^/]+)/?([^/]*)$', self.path)
            if not segments:
                self.send_error(400)
            else:
                command, door_name, scenario_name = segments.groups()
                if command == 'start':
                    numeric = re.compile(r'^\s*([0-9]+)')
                    with open(os.path.join('scenarios', scenario_name + '.txt')) as f:
                        with lock:
                            next_scenarios[door_name] = doors.scenario(f.read())
                            next_scenarios[door_name]['name'] = scenario_name
                    self.send_response(204)
                elif command == 'arrive':
                    with lock:
                        model[door_name].arriving += 1
                    self.send_response(204)
                else:
                    self.send_error(400)
        except Exception as e:
            traceback.print_exc()
            self.send_error(500)
        self.end_headers()

    def log_request(*args):
        pass

dss.LiveSiteHandler = LiveSiteHandler
if not os.path.exists(os.path.dirname(log_path())):
    os.makedirs(os.path.dirname(log_path()))
server_start = datetime.now() # reset since connecting to Arduino takes time
advance()
try:
    print 'Serving on http://localhost:%s' % (cliargs.port or 8000)
    SocketServer.TCPServer.allow_reuse_address = True
    dss.DeadSimpleSite('.').serve(port=cliargs.port)
except KeyboardInterrupt:
    print # for shells that echo ctrl+c without newline
finally:
    alive = False
