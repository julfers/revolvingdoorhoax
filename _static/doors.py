#!/usr/bin/env python
'''
A model of abstract doors that the server uses to simulate door motion and can also compile to
JavaScript for the online monitor and in-browser demo.

The doors move in discrete intervals depending on whether someone is in them or waiting to use them.

Multi-threaded code should synchronize access to these classes.
'''

pi = 3.14159265359 # not sure how to get math.pi when using skulpt

def close_to(a, b, tolerance):
    ''' Check that two angles in radians are within tolerance of each other '''
    max = (b + tolerance) % (pi * 2)
    min = (b + pi * 2 - tolerance) % (pi * 2)
    if max < min:
        return a > min or a < max
    else:
        return a > min and a < max

class RevolvingDoor():

    def __init__(self, granularity, tolerance):
        ''' Create a revolving door that takes granularity steps to rotate a complete circle.
            Tolerance is represents the angle a person requires to enter the door, in number of
            steps.
        '''
        assert granularity % 8 == 0, 'granularity must be a multiple of 8'
        self.granularity = granularity
        self.tolerance = pi / granularity * tolerance
        self.arriving = 0
        self.position = 0
        self.occupied = [False, False, False, False]

    def angle(self, quadrant):
        ''' The angle that bisects the given quadrant, in current door position '''
        return pi * 2 / self.granularity * \
            ((self.position + quadrant * self.granularity / 4) % self.granularity)

    def step(self):
        ''' Rotate door one step (granularity radians), if anyone is present to use it, returning
            number of steps rotated, always one or zero.
        '''
        steps = 0
        for i in range(4):
            if self.occupied[i]:
                if close_to(self.angle(i), pi, pi / self.granularity):
                    self.occupied[i] = False
                else:
                    steps = 1
            else:
                if self.arriving and close_to(self.angle(i), 0, self.tolerance):
                    self.occupied[i] = True
                    self.arriving -= 1
        self.position += steps
        return steps

class SwingingDoor():

    def __init__(self, granularity, open_to):
        ''' Granularity is the size of a door step, in the closing cycle, as a number of steps in a
            a quarter circle. The door opens quicker, that is it moves in multiples of these steps
            on the open cycle.

            Open_to indicates how far the door should open, in steps of granularity size, to let a
            person enter.
        '''
        self.granularity = granularity
        self.open = open_to
        self.arriving = 0
        self.position = 0
        self.occupied = [False]

    def angle(self):
        ''' The door's opennes, in radians. '''
        return pi / 2 / self.granularity * self.position

    def step(self):
        steps = 0
        self.occupied[0] = False
        if self.arriving:
            steps = min(self.position + 4, self.open) - self.position
        elif self.position > 0:
            steps = -1
        self.position += steps
        if self.position == self.open:
            self.arriving -= 1
            self.occupied[0] = True
        return steps

def scenario(source):
    ''' Scenario file format is three sections separated by blank lines::

            Title
            
            Description
            
            People arriving - one line per step
    '''
    # More awkward than normal because it needs to work in Skulpt
    r  = {'title': '', 'description': '', 'arrivals': []}
    keys = ['title', 'description']
    k = 0
    for line in source.split('\n'):
        line = line.strip()
        if line:
            if k == 2:
                r['arrivals'].append(int(line))
            else:
                r[keys[k]] += ' ' + line
        elif k < 2:
            k += 1
    return r

if __name__ == '__main__': # Run this as a script to execute the tests - silent if all pass
    assert close_to(0, 0, pi / 16), 'zero is close to itself'
    assert close_to(1, 1, pi / 16), 'one is close to itself'
    assert not close_to(1, 0, pi / 16), 'one is not close to zero'
    assert close_to(pi / (2 * 16), 0, pi / 16), 'half of tolerance is still close'
    assert close_to(pi * 2 - pi / (2 * 16), 0, pi / 16), 'almost a full circle is almost zero'

    revolver = RevolvingDoor(16, 1)
    # initial state tests
    assert revolver.angle(0) == 0, 'quadrant zero starts at angle zero'
    assert revolver.angle(1) == pi / 2.0, 'quadrant one starts at quarter circle'
    assert revolver.step() == 0, 'zero steps when noone waiting'
    assert revolver.angle(0) == 0, 'door does not advance without people'
    revolver.arriving += 1
    assert revolver.step() == 0, 'no motion when entering the door'
    # one person through door
    assert revolver.arriving == 0, 'person moved into door'
    assert revolver.occupied[0], 'person occupied cell zero'
    assert revolver.angle(0) == 0, 'door did not yet move'
    for i in range(revolver.granularity / 4): # quarter turn
        assert revolver.step() == 1, 'moves when occupied'
    assert revolver.occupied[0], 'person is still in cell zero'
    assert revolver.angle(0) == pi / 2, 'quadrant zero has moved one quarter'
    assert revolver.angle(3) == 0, 'last section is now at angle zero'
    for i in range(revolver.granularity / 4):
        revolver.step()
    assert revolver.angle(0) == pi, 'door completed a half rotation for one person'
    assert revolver.occupied[0], 'occupant still present'
    revolver.step()
    assert not revolver.occupied[0], 'occupant left'
    assert revolver.angle(0) == pi, 'door did not move for occupant exit'
    # two people arriving
    revolver.arriving = 2
    revolver.step() # let first person enter
    for i in range(revolver.granularity / 2):
        revolver.step()
    assert revolver.arriving == 0, 'all people entered door'
    assert revolver.occupied[2] and revolver.occupied[1], 'cells 2 and 1 are occupied'
    assert revolver.angle(0) == 0, 'quadrant zero back to angle zero after full turn'
    for i in range(revolver.granularity / 4):
        revolver.step()
    assert not revolver.occupied[2], 'first occupant exited'
    assert revolver.occupied[1], 'last occupant has not left yet'
    revolver.step()
    assert not revolver.occupied[1], 'three quarter rotation moves two people through'

    revolver = RevolvingDoor(16, 3)
    revolver.arriving += 1
    for i in range(revolver.granularity / 8 * 3): # move next cell to half-exposed
        revolver.step()
    revolver.arriving += 1
    revolver.step()
    assert revolver.arriving == 0, 'higher tolerance allows person in later'
    for i in range(revolver.granularity / 2):
        revolver.step()
    assert revolver.arriving == 0, 'everyone left'
    assert revolver.angle(3) == pi, 'door stopped in correct position'

    swinger = SwingingDoor(8, 7)
    step_size = pi / 2 / 8
    assert swinger.angle() == 0, 'door starts at angle zero'
    assert swinger.step() == 0, 'zero steps when noone waiting'
    assert swinger.angle() == 0, 'step does not change angle without people'
    swinger.arriving += 2
    assert swinger.step() == 4, 'four steps to start opening'
    assert swinger.angle() == step_size * 4, 'door starts opens about halfway when someone is present'
    assert swinger.step() == 3, 'three steps to finish opening'
    assert swinger.angle() == step_size * 7, 'door does not open past max'
    assert swinger.arriving == 1, 'person entered on same step as full open'
    assert swinger.step() == 0, 'door does not move when next person enterrs'
    assert swinger.angle() == step_size * 7, 'door remains open when people walk through'
    assert swinger.arriving == 0, 'last person has entered'
    assert swinger.step() == -1, 'door direction reverses on closing'
    assert swinger.angle() == step_size * 6, 'door has closed one step'
    for i in range(swinger.position):
        assert swinger.step() == -1, 'door continues closing'
    assert swinger.angle() == 0, 'door fully closed'
