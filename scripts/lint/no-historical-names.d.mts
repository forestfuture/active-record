// The no-historical-names rule's type, and the name check the guide's test reads, for tests to import.
import type { Rule } from "vite-plus/lint/plugins";

/** The first historical name in `text`, as written there, or undefined for none. */
export declare function historicalName(text: string): string | undefined;

declare const noHistoricalNames: Rule;
export default noHistoricalNames;
