declare module "@citation-js/core" {
  export interface CiteOptions {
    readonly format?: string;
    readonly type?: string;
    readonly style?: string;
    readonly template?: string;
    readonly lang?: string;
  }

  export class Cite {
    public constructor(data?: unknown, options?: unknown);
    public static async(data?: unknown, options?: unknown): Promise<Cite>;
    public readonly data: Array<Record<string, unknown>>;
    public format(format: string, options?: CiteOptions): unknown;
  }

  export const plugins: {
    readonly config: {
      get(name: string): {
        readonly styles: {
          add(name: string, style: string): void;
          has(name: string): boolean;
        };
      };
    };
  };
}

declare module "@citation-js/plugin-bibtex";
declare module "@citation-js/plugin-csl";
declare module "@citation-js/plugin-ris";
