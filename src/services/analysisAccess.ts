/** Public build flag affects UI only; server mode and quota always authorize. */
export const normalAnalysisAccess = import.meta.env.VITE_ANALYSIS_ACCESS_MODE === "authenticated";
