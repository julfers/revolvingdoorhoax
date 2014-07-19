#!/usr/bin/env python
'''
Functions to manipulate model results output.
'''
import sys

def summarize(log, secs_per_row=15):
    ''' Summarize results to a log with entries at secs_per_row intervals. The log is an array of
        temperature readings and people arrival sums:

            [time, revolver_arrivals, swinger_arrivals, temp, temp, temp, temp]

        Time is in seconds since simulation start, temps are thirds of a degree C, averaged over the
        interval, and arrivals are the people arrival rates over the interval, in people per minute.

        All values are floating point numbers.
    '''
    summary_log = []
    edge = secs_per_row # 15 seconds per summary row
    count = 0
    sums = [0] * 6
    for r in log:
        count += 1
        for i, v in enumerate(r[1:]):
            sums[i] += v
        if r[0] > edge:
            arrivals = [60.0 / secs_per_row * a for a in sums[0:2]]
            temps = [float(t) / count for t in sums[2:]]
            summary = [r[0]] + arrivals + temps
            summary_log.append(summary)
            edge += secs_per_row
            count = 0
            sums = [0] * 6
    return summary_log

def to_csv(log):
    ''' Turn an array of arrays into CSV format. '''
    # Don't bother using csv module because the data never needs escaping
    return '\n'.join([','.join([str(v) for v in r]) for r in log])

def from_csv(csv):
    log = []
    for raw in csv.splitlines():
        r = raw.split(',')
        log.append([float(r[0])] + [int(v) for v in r[1:]])
    return log

if __name__ == '__main__':
    with open(sys.argv[1]) as log_csv:
        log = from_csv(log_csv.read())
    print to_csv(summarize(log, int(sys.argv[2])))
