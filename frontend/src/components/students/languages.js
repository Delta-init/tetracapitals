/* The language a student studies in, as the sales CRMs ask it at every close
   (backend/src/students/language.ts keeps the same four). */
export const LANGUAGES = ['English', 'Malayalam', 'Hindi/Urdu', 'Tamil'];

/** Radix Select cannot hold "" as a value, so "not set" travels as this. */
export const NO_LANGUAGE = '__none__';
