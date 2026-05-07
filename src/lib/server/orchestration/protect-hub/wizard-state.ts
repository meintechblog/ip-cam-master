// v1.3 Phase 22 Plan 01 — Wizard pointer service (per L-15 + HUB-WIZ-09 + HUB-WIZ-10).
//
// Single-row table service. id=1 always upserted. setPointer / resetPointer /
// completePointer are the only mutators; +page.server.ts and the wizard step
// endpoints (Plan 02) call into them.
//
// HUB-WIZ-09 (resumability): getPointer() reads the row so the wizard host
// page can render the "Du warst bei Schritt N — weiter?" banner across browser
// closes and SvelteKit restarts.
//
// HUB-WIZ-10 (atomic completion): completePointer() leaves the row in place
// (status='completed', step=6) so Plan 02's wizard/complete endpoint can flip
// protect_hub_enabled in the same transaction the pointer reaches its terminal
// state. resetPointer() is the only path that DELETEs the row.
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { hubOnboardingState } from '$lib/server/db/schema';

export type WizardPointer = typeof hubOnboardingState.$inferSelect;

export function getPointer(): WizardPointer | null {
	return (
		db.select().from(hubOnboardingState).where(eq(hubOnboardingState.id, 1)).get() ?? null
	);
}

export function setPointer(step: number, error: string | null = null): void {
	const existing = getPointer();
	const now = new Date().toISOString();
	if (!existing) {
		db.insert(hubOnboardingState)
			.values({ id: 1, step, status: 'in_progress', lastActivityAt: now, error })
			.run();
	} else {
		db.update(hubOnboardingState)
			.set({ step, status: 'in_progress', lastActivityAt: now, error })
			.where(eq(hubOnboardingState.id, 1))
			.run();
	}
}

export function resetPointer(): void {
	db.delete(hubOnboardingState).where(eq(hubOnboardingState.id, 1)).run();
}

export function completePointer(): void {
	const now = new Date().toISOString();
	const existing = getPointer();
	if (!existing) {
		db.insert(hubOnboardingState)
			.values({ id: 1, step: 6, status: 'completed', lastActivityAt: now, error: null })
			.run();
	} else {
		db.update(hubOnboardingState)
			.set({ step: 6, status: 'completed', lastActivityAt: now, error: null })
			.where(eq(hubOnboardingState.id, 1))
			.run();
	}
}
