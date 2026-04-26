export type Random = () => number;

export const makeRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const sideSign = (side: "long" | "short") => (side === "long" ? 1 : -1);

export const randomChoice = <T>(random: Random, values: readonly T[]) =>
  values[Math.min(values.length - 1, Math.floor(random() * values.length))];

export const randomNormal = (random: Random) => {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

export const sampleAroundPct = (random: Random, averagePct: number, widthPct = 55) => {
  const spread = averagePct * (widthPct / 100);
  return clamp(averagePct + randomNormal(random) * spread, averagePct * 0.15, averagePct * 2.25);
};

export const sampleHoldingDays = (random: Random, averageDays: number, maxDays: number) => {
  const exponential = -Math.log(Math.max(1 - random(), Number.EPSILON)) * averageDays;
  return Math.max(1, Math.min(maxDays, Math.round(exponential)));
};

export const sampleTruncatedPareto = (
  random: Random,
  alpha: number,
  minValue: number,
  maxValue: number
) => {
  const exponent = 1 - Math.max(1.01, alpha);
  const minPow = minValue ** exponent;
  const maxPow = maxValue ** exponent;
  return (minPow + random() * (maxPow - minPow)) ** (1 / exponent);
};
