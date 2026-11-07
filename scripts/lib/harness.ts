/**
 * Tiny assertion/scenario harness. Every assertion prints PASS/FAIL; a failed
 * assertion does not abort the scenario, but any failure makes the run exit 1.
 * An exception inside a scenario is reported as a FAIL for that scenario.
 * Set E2E_ONLY=<scenario name> to run a single scenario.
 */
export type Scenario = { name: string; run: () => Promise<void> };

let passed = 0;
let failed = 0;
const failures: string[] = [];
let current = "";

export function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(`${current}: ${label}`);
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

export function checkEq<T extends bigint | number | string | boolean>(
  label: string,
  actual: T,
  expected: T
) {
  check(label, actual === expected, `expected ${expected}, got ${actual}`);
}

/** Assert that `fn` rejects (optionally with a message matching `pattern`). */
export async function checkRejects(
  label: string,
  fn: () => Promise<unknown>,
  pattern?: RegExp
) {
  try {
    await fn();
    check(label, false, "did not fail");
  } catch (e) {
    const msg = (e as Error).message;
    check(label, pattern ? pattern.test(msg) : true, `got: ${msg}`);
  }
}

export async function runScenarios(scenarios: Scenario[]): Promise<number> {
  const only = process.env.E2E_ONLY;
  for (const s of scenarios) {
    if (only && s.name !== only) continue;
    current = s.name;
    console.log(`\n=== Scenario: ${s.name} ===`);
    try {
      await s.run();
    } catch (e) {
      failed++;
      failures.push(`${s.name}: exception`);
      console.log(`  FAIL  scenario threw: ${(e as Error).stack ?? e}`);
    }
  }
  console.log(
    `\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed`
  );
  for (const f of failures) console.log(`  - ${f}`);
  return failed === 0 ? 0 : 1;
}
