# The great revolving door hoax #

Visit the project site at http://revolvingdoorhoax.org.

## Run the experiment ##

Set up to expect a virtualenv:

```
virtualenv --python=python2 venv-rdx
```

1. Build a physical model as described in :doc:`model`
2. Install the control and data gathering code on Arduino
3. Run the controller `./serve.py`
4. Visit http://localhost:8000/model.html

Depends on:

* [Python 2] for everything except code that runs on Arduino
* [pySerial] to control Arduino
* [Arduino IDE], to upload Arduino software. Alternatively, [Ino] may do the trick, but I haven't
    tested with it.
* [Adafruit Motor Shield V2 library], to control the stepper motor

Dependencies bundled with this project. Note they have their own licenses:

* [jQuery]
* [Skulpt]
* [AsciiMathML]

## Build the site ##

The site builds with [Sphinx]

```
pip install sphinx
make clean html
```

[Python 2]: https://www.python.org/
[Sphinx]: http://sphinx-doc.org/latest/install.html
[pySerial]: http://pyserial.sourceforge.net/
[Arduino IDE]: http://arduino.cc/en/main/software
[Ino]: http://inotool.org/
[Adafruit Motor Shield V2 library]: https://learn.adafruit.com/adafruit-motor-shield-v2-for-arduino/library-reference
[jQuery]: http://jquery.com/
[Skulpt]: http://www.skulpt.org/
[AsciiMathML]: http://asciimath.org/
