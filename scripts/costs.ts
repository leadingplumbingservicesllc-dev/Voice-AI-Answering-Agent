// Illustrative USD assumptions only; refresh from linked official pages before launch.
const rates = {
  numberMonthly: 1.15,
  hostMonthly: 7,
  diskGbMonthly: 0.25,
  diskGb: 1,
  inboundMinute: 0.0085,
  relayMinute: 0.07,
  smsSegment: 0.0083,
  inputMillion: 0.4,
  outputMillion: 1.6,
};
const assumptions = {
  minutesPerCall: 3,
  segmentsPerSummary: 2,
  recipients: 2,
  inputTokensPerCall: 12000,
  outputTokensPerCall: 1200,
  urgentFraction: 0,
  segmentsPerUrgent: 2,
};
console.log(
  "ILLUSTRATIVE, NOT VERIFIED CURRENT PRICING. USD, excludes carrier fees, registration, transfer legs, taxes and backup storage.",
);
for (const calls of [100, 300, 1000]) {
  const fixed =
    rates.numberMonthly +
    rates.hostMonthly +
    rates.diskGbMonthly * rates.diskGb;
  const voice = calls * assumptions.minutesPerCall * rates.inboundMinute;
  const relay = calls * assumptions.minutesPerCall * rates.relayMinute;
  const model =
    (calls *
      (assumptions.inputTokensPerCall * rates.inputMillion +
        assumptions.outputTokensPerCall * rates.outputMillion)) /
    1e6;
  const sms =
    calls *
    assumptions.segmentsPerSummary *
    assumptions.recipients *
    rates.smsSegment;
  const urgent =
    calls *
    assumptions.urgentFraction *
    assumptions.segmentsPerUrgent *
    assumptions.recipients *
    rates.smsSegment;
  console.log({
    calls,
    fixed: fixed.toFixed(2),
    voice: voice.toFixed(2),
    relay: relay.toFixed(2),
    model: model.toFixed(2),
    sms: sms.toFixed(2),
    urgent: urgent.toFixed(2),
    total: (fixed + voice + relay + model + sms + urgent).toFixed(2),
  });
}
