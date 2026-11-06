/**
 * Offers adding the page to the home screen, which keeps the season's link: the installed app
 * starts at the URL it was installed from.
 */
class Install {
	/** Chromium's install prompt, once it offers one. */
	prompt: (Event & { prompt(): Promise<void> }) | null = $state(null);
	dismissed = $state(localStorage.getItem('installHint') === 'dismissed');
	/** Whether the page runs as an installed app. */
	readonly standalone =
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as { standalone?: boolean }).standalone === true;
	/** Only Safari has navigator.standalone; on iOS, Add to Home Screen is in its Share menu. */
	readonly safari = 'standalone' in navigator;
	/** Phones and tablets, where the home screen is the way back to the page. */
	readonly touch = matchMedia('(pointer: coarse)').matches;

	dismiss() {
		this.dismissed = true;
		localStorage.setItem('installHint', 'dismissed');
	}
}

export const install = new Install();

// Chromium fires this once the page is installable, which can be before the player is shown.
addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	install.prompt = e as Install['prompt'];
});
addEventListener('appinstalled', () => (install.prompt = null));
