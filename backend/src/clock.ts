export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FrozenClock implements Clock {
  private currentTime: Date;

  constructor(initialTime: Date | string) {
    this.currentTime = new Date(initialTime);
  }

  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  set(time: Date | string): void {
    this.currentTime = new Date(time);
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  advanceMinutes(minutes: number): void {
    this.advance(minutes * 60 * 1000);
  }
}

export const systemClock = new SystemClock();
