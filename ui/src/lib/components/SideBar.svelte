<script lang="ts">
	import { Button } from 'm3-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const isActive = (path: string) => {
		const current = page.url.pathname.replace(/\/$/, '') || '/';
		const target = path.replace(/\/$/, '') || '/';
		return current === target;
	};
</script>

<div class="hidden items-center justify-center md:flex">
	<div
		class="bg-surface-container-high fixed top-0 left-0 flex h-full flex-col items-center justify-between p-4"
	>
		<div class="mt-3 mb-3 flex flex-col items-center justify-center gap-2">
			<div class="button-mod flex flex-col items-center justify-center gap-2">
				<div class="flex flex-col items-center justify-center">
					<Button
						variant={isActive('/') ? 'filled' : 'outlined'}
						iconType="full"
						click={() => {
							goto(resolve('/'));
						}}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
							<path d="M0 0h24v24H0z" fill="none" />
							<path
								fill="currentColor"
								d="M4 19v-9q0-.475.213-.9t.587-.7l6-4.5q.525-.4 1.2-.4t1.2.4l6 4.5q.375.275.588.7T20 10v9q0 .825-.588 1.413T18 21h-3q-.425 0-.712-.288T14 20v-5q0-.425-.288-.712T13 14h-2q-.425 0-.712.288T10 15v5q0 .425-.288.713T9 21H6q-.825 0-1.412-.587T4 19"
							/>
						</svg>
					</Button>
					<h1>Home</h1>
				</div>
				<div class="flex flex-col items-center justify-center">
					<Button
						variant={isActive('/notes') ? 'filled' : 'outlined'}
						iconType="full"
						click={() => {
							goto(resolve('/notes'));
						}}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
							<path d="M0 0h24v24H0z" fill="none" />
							<path
								fill="currentColor"
								d="M17.5 18.5v2q0 .2.15.35T18 21t.35-.15t.15-.35v-2h2q.2 0 .35-.15T21 18t-.15-.35t-.35-.15h-2v-2q0-.2-.15-.35T18 15t-.35.15t-.15.35v2h-2q-.2 0-.35.15T15 18t.15.35t.35.15zM18 23q-2.075 0-3.537-1.463T13 18t1.463-3.537T18 13t3.538 1.463T23 18t-1.463 3.538T18 23M8 9h8q.425 0 .713-.288T17 8t-.288-.712T16 7H8q-.425 0-.712.288T7 8t.288.713T8 9M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v5.45q0 .45-.375.7t-.8.1q-.425-.125-.888-.188T18 11q-.275 0-.513.013t-.487.062q-.225-.05-.5-.062T16 11H8q-.425 0-.712.288T7 12t.288.713T8 13h5.125q-.45.425-.812.925T11.675 15H8q-.425 0-.712.288T7 16t.288.713T8 17h3.075q-.05.25-.062.488T11 18q0 .5.05.95t.175.875t-.125.8t-.675.375z"
							/>
						</svg>
					</Button>
					<h1>Notes</h1>
				</div>
				<div class="flex flex-col items-center justify-center">
					<Button
						variant={isActive('/strategy') ? 'filled' : 'outlined'}
						iconType="full"
						click={() => {
							goto(resolve('/strategy'));
						}}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
							<path
								fill="currentColor"
								d="M8 4c-.55 0-1 .45-1 1v1H6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h1v1c0 .55.45 1 1 1s1-.45 1-1v-1h1c.55 0 1-.45 1-1V7c0-.55-.45-1-1-1H9V5c0-.55-.45-1-1-1m8 3c-.55 0-1 .45-1 1v1h-1c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1h1v1c0 .55.45 1 1 1s1-.45 1-1v-1h1c.55 0 1-.45 1-1v-7c0-.55-.45-1-1-1h-1V8c0-.55-.45-1-1-1"
							/>
						</svg>
					</Button>
					<h1>Strategy</h1>
				</div>
			</div>
		</div>
		<div class="mb-3 flex justify-center">
			<Button
				variant="filled"
				iconType="full"
				square
				click={() => {
					goto(resolve('/settings'));
				}}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
					<path
						fill="currentColor"
						d="M10.825 22q-.675 0-1.162-.45t-.588-1.1L8.85 18.8q-.325-.125-.612-.3t-.563-.375l-1.55.65q-.625.275-1.25.05t-.975-.8l-1.175-2.05q-.35-.575-.2-1.225t.675-1.075l1.325-1Q4.5 12.5 4.5 12.337v-.675q0-.162.025-.337l-1.325-1Q2.675 9.9 2.525 9.25t.2-1.225L3.9 5.975q.35-.575.975-.8t1.25.05l1.55.65q.275-.2.575-.375t.6-.3l.225-1.65q.1-.65.588-1.1T10.825 2h2.35q.675 0 1.163.45t.587 1.1l.225 1.65q.325.125.613.3t.562.375l1.55-.65q.625-.275 1.25-.05t.975.8l1.175 2.05q.35.575.2 1.225t-.675 1.075l-1.325 1q.025.175.025.338v.674q0 .163-.05.338l1.325 1q.525.425.675 1.075t-.2 1.225l-1.2 2.05q-.35.575-.975.8t-1.25-.05l-1.5-.65q-.275.2-.575.375t-.6.3l-.225 1.65q-.1.65-.587 1.1t-1.163.45zm1.225-6.5q1.45 0 2.475-1.025T15.55 12t-1.025-2.475T12.05 8.5q-1.475 0-2.488 1.025T8.55 12t1.013 2.475T12.05 15.5"
					/>
				</svg>
			</Button>
		</div>
	</div>
</div>

<style>
	.button-mod :global(button) {
		padding-left: 30px;
		padding-right: 30px;
	}

	.button-mod :global(svg) {
		scale: 0.8;
	}

	.button-mod h1 {
		font-size: 10px;
		font-weight: 500;
		color: var(--color-secondary);
	}
</style>
