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
    ''' An abstract door. When using this door, multi-threaded code should synchronize access. '''

    def __init__(self, granularity, tolerance):
        ''' Create a revolving door that takes granularity steps to rotate a complete circle.
            Tolerance is represents the angle a person requires to enter the door, in number of
            steps. '''
        assert granularity % 8 == 0, 'granularity must be a multiple of 8'
        self.granularity = granularity
        self.tolerance = pi / granularity * tolerance
        self.arriving = 0
        self.occupied = [False, False, False, False]
        self.position = 0

    def angle(self, quadrant):
        ''' The angle that bisects the given quadrant, in current door position '''
        return pi * 2 / self.granularity * \
            ((self.position + quadrant * self.granularity / 4) % self.granularity)

    def step(self):
        ''' Rotate door one step (granularity radians), if anyone is present to use it. '''
        rotate = False
        for i in range(4):
            if self.occupied[i]:
                if close_to(self.angle(i), pi, pi / self.granularity):
                    self.occupied[i] = False
                else:
                    rotate = True
            else:
                if self.arriving and close_to(self.angle(i), 0, self.tolerance):
                    self.occupied[i] = True
                    self.arriving -= 1
        if rotate:
            self.position += 1
        return rotate

if __name__ == '__main__':
    assert close_to(0, 0, pi / 16), 'zero is close to itself'
    assert close_to(1, 1, pi / 16), 'one is close to itself'
    assert not close_to(1, 0, pi / 16), 'one is not close to zero'
    assert close_to(pi / (2 * 16), 0, pi / 16), 'half of tolerance is still close'
    assert close_to(pi * 2 - pi / (2 * 16), 0, pi / 16), 'almost a full circle is almost zero'

    revolver = RevolvingDoor(16, 1)
    # initial state tests
    assert revolver.angle(0) == 0, 'quadrant zero starts at angle zero'
    assert revolver.angle(1) == pi / 2.0, 'quadrant one starts at quarter circle'
    revolver.step()
    assert revolver.angle(0) == 0, 'door does not advance without people'
    revolver.arriving += 1
    revolver.step()
    # one person through door
    assert revolver.arriving == 0, 'person moved into door'
    assert revolver.occupied[0], 'person occupied cell zero'
    assert revolver.angle(0) == 0, 'door did not yet move'
    for i in range(revolver.granularity / 4): # quarter turn
        revolver.step()
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
