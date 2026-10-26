<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import OnboardingCard from './OnboardingCard.svelte';
  import OnboardingHello from './OnboardingHello.svelte';
  import OnboardingTheme from './OnboardingTheme.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { Route } from '$lib/route';
  import { OnboardingRole } from '$lib/types';
  import { setUserOnboarding, updateAdminOnboarding } from '@immich/sdk';
  import { mdiThemeLightDark } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface OnboardingStep {
    name: string;
    component: typeof OnboardingHello | typeof OnboardingTheme;
    role: OnboardingRole;
    title?: string;
    icon?: string;
  }

  const onboardingSteps: OnboardingStep[] = $derived([
    { name: 'hello', component: OnboardingHello, role: OnboardingRole.USER },
    {
      name: 'theme',
      component: OnboardingTheme,
      role: OnboardingRole.USER,
      title: $t('theme'),
      icon: mdiThemeLightDark,
    },
  ]);

  const index = $derived.by(() => {
    const stepState = page.url.searchParams.get('step');
    const temporaryIndex = onboardingSteps.findIndex((step) => step.name === stepState);
    return temporaryIndex === -1 ? 0 : temporaryIndex;
  });
  let userRole = $derived(
    authManager.user.isAdmin && !serverConfigManager.value.isOnboarded ? OnboardingRole.SERVER : OnboardingRole.USER,
  );

  let onboardingStepCount = $derived(onboardingSteps.filter((step) => shouldRunStep(step.role, userRole)).length);
  let onboardingProgress = $derived(
    onboardingSteps.filter((step, i) => shouldRunStep(step.role, userRole) && i <= index).length - 1,
  );

  const shouldRunStep = (stepRole: OnboardingRole, userRole: OnboardingRole) => {
    return (
      stepRole === OnboardingRole.USER ||
      (stepRole === OnboardingRole.SERVER &&
        userRole === OnboardingRole.SERVER &&
        !serverConfigManager.value.isOnboarded)
    );
  };

  const previousStepIndex = $derived(
    onboardingSteps.findLastIndex((step, i) => shouldRunStep(step.role, userRole) && i < index),
  );

  const nextStepIndex = $derived(
    onboardingSteps.findIndex((step, i) => shouldRunStep(step.role, userRole) && i > index),
  );

  const handleNextClicked = async () => {
    if (nextStepIndex === -1) {
      if (authManager.user.isAdmin) {
        await updateAdminOnboarding({ adminOnboardingUpdateDto: { isOnboarded: true } });
        await serverConfigManager.loadServerConfig();
      }

      await setUserOnboarding({
        onboardingDto: { isOnboarded: true },
      });

      await goto(Route.photos());
    } else {
      await goto(Route.onboarding({ step: onboardingSteps[nextStepIndex].name }));
    }
  };

  const handlePrevious = async () => {
    if (previousStepIndex === -1) {
      return;
    }

    await goto(Route.onboarding({ step: onboardingSteps[previousStepIndex].name }));
  };

  const OnboardingStep = $derived(onboardingSteps[index].component);
</script>

<section id="onboarding-page" class="flex min-h-dvh min-w-dvw p-4">
  <div class="flex w-full flex-col">
    <div class="h-2 rounded-md bg-gray-300 dark:bg-gray-600">
      <div
        class="progress-bar h-2 rounded-md bg-primary transition-all duration-200 ease-out"
        style="width: {(onboardingProgress / onboardingStepCount) * 100}%"
      ></div>
    </div>
    <div class="m-auto flex w-[min(100%,800px)] place-content-center place-items-center py-8">
      <OnboardingCard
        title={onboardingSteps[index].title}
        icon={onboardingSteps[index].icon}
        onNext={handleNextClicked}
        onPrevious={handlePrevious}
        previousTitle={onboardingSteps[previousStepIndex]?.title}
        nextTitle={onboardingSteps[nextStepIndex]?.title}
      >
        <OnboardingStep />
      </OnboardingCard>
    </div>
  </div>
</section>
