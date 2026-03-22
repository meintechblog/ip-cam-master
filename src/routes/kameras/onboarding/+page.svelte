<script lang="ts">
	import OnboardingWizard from '$lib/components/onboarding/OnboardingWizard.svelte';
	let { data } = $props();
</script>

<h1 class="text-2xl font-bold text-text-primary mb-6">Kamera einrichten</h1>
<OnboardingWizard nextVmid={data.nextVmid} />
