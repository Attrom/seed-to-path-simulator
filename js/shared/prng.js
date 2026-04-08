export class FlightRandom {
  constructor() { this.s0 = 0; this.s1 = 0; this.s2 = 0; }

  seed(v) {
    this.s0 = v;
    this.s1 = v * 213947 + 1238971;
    this.s2 = v * 7431 + 94823;
    this.random();
  }

  random(max = Number.MAX_SAFE_INTEGER) {
    let t = this.s0;
    const s = this.s1;
    this.s0 = s;
    t ^= t << 23;
    t ^= t >> 17;
    t ^= s;
    t ^= s >> 26;
    this.s1 = t;
    this.s2 = (1103515245 * this.s2 + 12345) % 2147483648;
    return (this.s0 + this.s1 + this.s2) % max;
  }
}
