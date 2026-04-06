export type PhonemisLocale = 'en_us' | 'en-us' | 'en_gb' | 'en-gb';

export declare function phonemize(text: string, locale?: PhonemisLocale): Promise<string>;
export declare function clearCaches(): void;
export declare const isAvailable: boolean;

declare const _default: {
  phonemize: typeof phonemize;
  clearCaches: typeof clearCaches;
  isAvailable: typeof isAvailable;
};

export default _default;