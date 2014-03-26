/*
Use to calibrate temperature sensors, specifically tmp36. This measures temperature
for some amount of time, decides whether the readings look stable, and prints output
to the serial console with the mmeasured average millivolts.

With readings at two different known temperatures, you can then use this information
to calibrate the temperature sensors. Adjust the values in the calibrateTemp() function
to the measurements, then copy from START to END into your sketch.
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

const int MAX_READINGS = 120;
int readings[SENSORS][MAX_READINGS];
int readIndex = 0;

void readSensors () {
  for (int pin = 0; pin < SENSORS; pin++) {
    readings[pin][readIndex] = millivolts(pin);
  }
  readIndex = (readIndex + 1) % MAX_READINGS;
}

int meanMv (int pin) {
  long total = 0;
  for (int i = 0; i < MAX_READINGS; i++) {
    total += readings[pin][i];
  }
  return total / MAX_READINGS;
}

boolean stable (int pin) {
  // Reading deemed stable if all readings are in range of mean
  // plus or minus tolerance millivolts, inclusive.
  // 3 is a good tolerance for 3V reference, since it's about one step in
  // either direction (3000 / 1024)
  int tolerance = 3;
  int minMv = meanMv(pin) - tolerance;
  int maxMv = meanMv(pin) + tolerance;
  for (int i = 0; i < MAX_READINGS; i++) {
    if (readings[pin][i] < minMv || readings[pin][i] > maxMv) {
      return false;
    }
  }
  return true;
}

void setup () {
  analogReference(EXTERNAL);
  Serial.begin(9600);
  calibrateTemp();
}

void loop () {
  if (readIndex == 0) {
    for (int pin = 0; pin < SENSORS; pin++) {
      Serial.print(degreesC(pin));
      Serial.print(" ");
    }
    Serial.println();
  }
  // 500 is a good delay for 120 readings, to calculate temp over 1 minute
  delay(500);
  readSensors();
  if (readIndex % 10 == 0) {
    Serial.print(".");
  }
  if (readIndex == 0) {
    Serial.println();
    for (int pin = 0; pin < SENSORS; pin++) {
      Serial.print(meanMv(pin));
      Serial.print(" ");
      Serial.println(stable(pin) ? "stable" : "unstable");
    }
  }
}

