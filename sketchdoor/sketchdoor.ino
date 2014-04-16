/* 
Runs on Arduino to accept commands from the server and report back temperature readings.

Uses Adafruit Motor Shield v2 (http://www.adafruit.com/products/1438)
*/

#include <Servo.h>
#include <Wire.h>
// Motor shield libraries: http://learn.adafruit.com/adafruit-motor-shield-v2-for-arduino/install-software
#include <Adafruit_MotorShield.h>
#include "utility/Adafruit_PWMServoDriver.h"

Adafruit_MotorShield AFMS = Adafruit_MotorShield(); 
// Stepper motor steps per revolution (28BYJ-48 motor from http://adafruit.com/products/918)
const int R_STEPS = 513;
// Simulation steps per revolution (matches abstract door in server)
const int R_GRANULARITY = 16;
// Swinging door values are close to degrees, but need calibration depending on the servo
const int S_CLOSED = 2; // closed position
const int QUARTER_PI = 52; // 45 degrees from closed position
// on port #2 (M3 and M4)
Adafruit_StepperMotor revolver = *AFMS.getStepper(R_STEPS, 2);
Servo swinger;

/*
Protocol to communicate with controller. Separators for incoming commands can be
any non-integer value, since all commands are base 10 integers.

1. serial port sends a command:
   [rotate] [swing] [duration]
   `rotate` will be 0 or 1 depending on whether the motor should rotate
   `swing` will be an angle from 0 to 90 degrees to open the swinging door
   `duration` will be how long to take before calling for the next turn (millis), the
     motor adjusts so it takes that long to complete the turn
2. After running the specified time, call for next commands

When incoming data does not contain a delimiter (non-numeric character), Serial.parseInt()
seems to either wait a little, causing unwarranted delay, or time out and return zero,
so the controller program must be sure to always send a delimiter to terminate a
command.
*/

// START temp sensor functions
const long AREF = 3000; // measured aref pin voltage
const int SENSORS = 4; // number of sensors, hooked up to analog read pins starting at 0

int millivolts (int pin) {
  return AREF * analogRead(pin) / 1024;
}

int tenMvPerC[SENSORS];
int offset[SENSORS];

void calibrateTemp () {
  // Call before reading any temperatures, in setup(), for example
  int tempA = 20; // Measured temperature at point A, Celcius
  int tempB = 8; // Measured B temp should be at least 10 less than A
  int actualA[SENSORS] = {643, 637, 634, 634}; // Average stable readings at A
  int actualB[SENSORS] = {542, 528, 521, 524};
  for (int pin = 0; pin < SENSORS; pin++) {
    tenMvPerC[pin] = (actualA[pin] - actualB[pin]) * 10 / (tempA - tempB);
    offset[pin] = 10 * actualA[pin] - tenMvPerC[pin] * tempA;
  }  
}

int degreesC (int pin) {
  return (10 * millivolts(pin) - offset[pin]) / tenMvPerC[pin];
}
// END temp sensor functions

void printTemp() {
  for (int pin = 0; pin < SENSORS; pin++) {
    Serial.print(degreesC(pin));
    Serial.print(" ");
  }
  Serial.println();
}

struct turn {
  int pos = 0;
  int stepsRemain = 0;
  int turnSteps = 0;
} rTurn, sTurn;
unsigned long duration = 0;
unsigned long turnEndTime = 0;
boolean fault = false;
boolean stepping = true;

void setup() {
  analogReference(EXTERNAL);
  AFMS.begin();  // create with the default frequency 1.6KHz
  swinger.attach(9);
  swinger.write(S_CLOSED);
  sTurn.pos = S_CLOSED;
  calibrateTemp();
  Serial.begin(9600);
  Serial.println("Doors are ready");
}

void loop() {
  if (fault) {
    return;
  }
  unsigned long timeRemain = turnEndTime > millis() ? turnEndTime - millis() : 0;
  while (duration * rTurn.stepsRemain > timeRemain * rTurn.turnSteps) {
    // speed * remaining steps > remaining time
    --rTurn.stepsRemain;
    revolver.onestep(BACKWARD, DOUBLE);
  }
  if (sTurn.turnSteps > 0) {
    while (duration * sTurn.stepsRemain > timeRemain * sTurn.turnSteps) {
      --sTurn.stepsRemain;
      swinger.write(sTurn.pos - sTurn.stepsRemain);
    }
  } else {
    while (sTurn.stepsRemain
          && duration * sTurn.stepsRemain < timeRemain * sTurn.turnSteps) {
      ++sTurn.stepsRemain;
      swinger.write(sTurn.pos - sTurn.stepsRemain);
    }
  }
  if (!timeRemain) {
    revolver.release(); // Do not heat motor for no work
    if (stepping) {
      printTemp();
      stepping = false;
    }
    if (Serial.available()) {
      stepping = true;
      bool rotate = Serial.parseInt();
      sTurn.stepsRemain = sTurn.turnSteps = Serial.parseInt() - sTurn.pos;
      sTurn.pos = sTurn.pos + sTurn.stepsRemain;
      duration = Serial.parseInt();
      turnEndTime = millis() + duration;
      if (Serial.read() != 10) {
        Serial.println("Fault: expected newline");
        fault = true;
        return; 
      }
      if (rotate) {
        int a = rTurn.pos * R_STEPS / R_GRANULARITY;
        int b = (rTurn.pos + 1) * R_STEPS / R_GRANULARITY;
        if (R_STEPS - b < R_STEPS / R_GRANULARITY) {
          // adjust since motor steps aren't divisible by sim steps
          b = R_STEPS;
        }
        rTurn.stepsRemain = rTurn.turnSteps = b - a;
        rTurn.pos = (rTurn.pos + 1) % R_GRANULARITY;
      }
    }
  }
}

