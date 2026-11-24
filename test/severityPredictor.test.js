const test = require('node:test');
const assert = require('node:assert/strict');
const { predictSeverityAndCareNeeds } = require('../src/services/severityPredictor');

const healthy = {
  heart_rate: 75,
  systolic_bp: 120,
  respiratory_rate: 16,
  spo2: 98,
  temperature: 36.8,
  gcs_score: 15,
};

test('normal vitals score low with no care needs', () => {
  const result = predictSeverityAndCareNeeds(healthy);
  assert.equal(result.news2Score, 0);
  assert.equal(result.severityLevel, 'low');
  assert.equal(result.predictedCareNeeds.icu, false);
  assert.equal(result.predictedCareNeeds.ventilator, false);
  assert.equal(result.predictedCareNeeds.specialist, null);
});

test('missing vitals do not throw and score zero', () => {
  const result = predictSeverityAndCareNeeds({});
  assert.equal(result.news2Score, 0);
  assert.equal(result.severityLevel, 'low');
  assert.ok(result.vitalBreakdown.every((entry) => entry.value === 'Not recorded'));
});

test('shock presentation is critical with ICU and ventilator needs', () => {
  const result = predictSeverityAndCareNeeds({
    ...healthy,
    heart_rate: 135,
    systolic_bp: 78,
    respiratory_rate: 32,
    spo2: 86,
    temperature: 35.1,
    gcs_score: 8,
    symptoms: ['major_trauma', 'hemorrhage'],
    mechanism_of_injury: 'mva_high_speed',
  });
  assert.equal(result.news2Score, 16);
  assert.equal(result.severityLevel, 'critical');
  assert.equal(result.predictedCareNeeds.icu, true);
  assert.equal(result.predictedCareNeeds.ventilator, true);
  assert.equal(result.predictedCareNeeds.specialist, 'trauma_surgeon');
  assert.equal(result.predictedCareNeeds.specialistUrgency, 'immediate');
  assert.ok(result.predictedCareNeeds.equipment.includes('trauma_bay'));
});

test('age modifier pushes a borderline score into the next severity band', () => {
  const borderline = {
    ...healthy,
    heart_rate: 105,
    respiratory_rate: 22,
    spo2: 94,
  };
  assert.equal(predictSeverityAndCareNeeds(borderline).news2Score, 4);
  assert.equal(predictSeverityAndCareNeeds(borderline).severityLevel, 'moderate');

  const paediatric = predictSeverityAndCareNeeds({ ...borderline, age: 8 });
  assert.equal(paediatric.news2Score, 5);
  assert.equal(paediatric.severityLevel, 'high');
  assert.equal(paediatric.ageModifier, 'Applied +1 for age risk factor');
});

test('GCS at or below 8 forces critical severity, ICU and ventilation', () => {
  const result = predictSeverityAndCareNeeds({ ...healthy, gcs_score: 8 });
  assert.equal(result.severityLevel, 'critical');
  assert.equal(result.predictedCareNeeds.icu, true);
  assert.equal(result.predictedCareNeeds.ventilator, true);
});

test('low SpO2 forces ventilator need even when other vitals are stable', () => {
  const result = predictSeverityAndCareNeeds({ ...healthy, spo2: 88 });
  assert.equal(result.severityLevel, 'critical');
  assert.equal(result.predictedCareNeeds.ventilator, true);
});

test('symptom mapping selects the matching specialist', () => {
  const result = predictSeverityAndCareNeeds({ ...healthy, symptoms: ['chest_pain'] });
  assert.equal(result.predictedCareNeeds.specialist, 'cardiologist');
  assert.ok(result.predictedCareNeeds.equipment.includes('cath_lab'));
  assert.deepEqual(result.predictedCareNeeds.flags, ['cardiac']);
});

test('symptom strings with spaces are normalised', () => {
  const result = predictSeverityAndCareNeeds({ ...healthy, symptoms: ['Chest Pain'] });
  assert.equal(result.predictedCareNeeds.specialist, 'cardiologist');
});
