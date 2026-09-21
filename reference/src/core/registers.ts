export type RegisterType = 'char' | 'line';

export interface RegisterContent {
  type: RegisterType;
  content: string;
}

export class Registers {
  private store = new Map<string, RegisterContent>();

  set(name: string, content: string, type: RegisterType): void {
    this.store.set(name, { type, content });
  }

  get(name: string): RegisterContent | undefined {
    return this.store.get(name);
  }
}
