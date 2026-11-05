// Paste this as the ENTIRE sketch (delete everything else). Upload, 115200, RST.
void setup() {
  pinMode(2, OUTPUT);
  Serial.begin(115200);
  delay(300);
  for (int i = 0; i < 8; i++) {
    Serial.println("HELLO FROM ESP32");
    digitalWrite(2, HIGH);
    delay(150);
    digitalWrite(2, LOW);
    delay(150);
  }
}

void loop() {
  Serial.println("loop ok");
  delay(1000);
}
