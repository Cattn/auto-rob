<script lang="ts">
	import { onMount } from 'svelte';
	import { getBackend } from '$lib/backend';
	import type { EquityQuotesResult } from '$lib/backend';

	type Holding = {
		symbol: string;
		quantity: number | null;
		loggedPrice: number | null;
		loggedValue: number | null;
		weight: number | null;
		loggedDayChange: number | null;
		loggedDayPercent: number | null;
	};

	let loadError = $state<string | null>(null);
	let loading = $state(true);
	let runLog = $state('');
	let changelog = $state('');
	let quoteResult = $state<EquityQuotesResult | null>(null);
	let quoteRequest = 0;

	function cleanLine(line: string): string {
		return line
			.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
			.replace(/[*_`]/g, '')
			.trim();
	}

	function section(markdown: string, names: string[]): string[] {
		const wanted = names.map((name) => name.toLowerCase());
		const lines = markdown.split(/\r?\n/);
		const collected: string[] = [];
		let active = false;

		for (const line of lines) {
			const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
			if (heading) {
				const title = cleanLine(heading[1]).toLowerCase();
				if (active) break;
				active = wanted.some((name) => title === name || title.startsWith(`${name} `));
				continue;
			}
			if (active && cleanLine(line)) collected.push(cleanLine(line));
		}

		if (collected.length > 0) return collected;
		for (const line of lines) {
			const cleaned = cleanLine(line);
			const match = cleaned.match(/^([^:]+):\s*(.+)$/);
			if (match && wanted.includes(match[1].trim().toLowerCase())) {
				return [match[2].trim()];
			}
		}
		return [];
	}

	function numberValue(value: string | undefined): number | null {
		if (!value) return null;
		const parsed = Number(value.replace(/,/g, ''));
		return Number.isFinite(parsed) ? parsed : null;
	}

	function parseHolding(line: string): Holding | null {
		const cleaned = cleanLine(line);
		const symbolMatch = cleaned.match(/^\$?([A-Z][A-Z0-9.-]{0,14})\b/i);
		if (!symbolMatch) return null;
		const symbol = symbolMatch[1].toUpperCase();
		if (symbol === 'REST') return null;
		const details = cleaned.slice(symbolMatch[0].length).trim().replace(/^[—–|,:-]+\s*/, '');
		const quantity =
			numberValue(details.match(/\b(?:qty|quantity)\s*[:=]?\s*([\d,.]+)/i)?.[1]) ??
			numberValue(details.match(/\b([\d,.]+)\s*(?:shares?|sh)\b/i)?.[1]);
		const loggedPrice = numberValue(
			details.match(/\b(?:current\s+)?price\s*[:=]?\s*~?\$([\d,.]+)/i)?.[1] ??
				details.match(/@\s*~?\$([\d,.]+)/)?.[1]
		);
		const loggedValue = numberValue(
			details.match(/\b(?:market\s+)?value\s*[:=]?\s*~?\$([\d,.]+)/i)?.[1]
		);
		const explicitWeight = numberValue(
			details.match(/\b(?:portfolio\s+)?weight\s*[:=]?\s*~?([\d.]+)\s*%/i)?.[1]
		);
		const compactWeight = numberValue(details.match(/^~?([\d.]+)\s*%$/)?.[1]);
		const day = details.match(/\bday(?:\s+(?:change|move))?\s*[:=]?\s*(.+)$/i)?.[1] ?? '';
		const loggedDayChange = numberValue(day.match(/([+-]?)\s*\$([\d,.]+)/)?.[2]);
		const loggedDaySign = day.match(/([+-]?)\s*\$[\d,.]+/)?.[1] === '-' ? -1 : 1;
		const loggedDayPercent = numberValue(day.match(/([+-]?\s*[\d.]+)\s*%/)?.[1]?.replace(/\s/g, ''));
		return {
			symbol,
			quantity,
			loggedPrice,
			loggedValue,
			weight: explicitWeight ?? compactWeight,
			loggedDayChange:
				loggedDayChange === null ? null : loggedDayChange * loggedDaySign,
			loggedDayPercent
		};
	}

	function matchMoney(text: string, pattern: RegExp): number | null {
		return numberValue(text.match(pattern)?.[1]);
	}

	function formatMoney(value: number | null, digits = 2): string {
		if (value === null) return '—';
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: digits,
			maximumFractionDigits: digits
		}).format(value);
	}

	function formatSignedMoney(value: number | null): string {
		if (value === null) return '—';
		return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
	}

	function formatPercent(value: number | null): string {
		if (value === null) return '—';
		return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
	}

	function marketLabel(state: string | null): string {
		const normalized = state?.toUpperCase();
		if (normalized === 'REGULAR') return 'Market open';
		if (normalized === 'PRE' || normalized === 'PREPRE') return 'Pre-market';
		if (normalized === 'POST' || normalized === 'POSTPOST') return 'After hours';
		if (normalized === 'CLOSED') return 'Market closed';
		if (normalized === 'DELAYED') return 'Delayed quote';
		return 'Updated';
	}

	function timeLabel(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString([], {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function isRawAccountMetadata(text: string): boolean {
		const signals = [
			/\baccount\s*:/i,
			/\bequity\s*:/i,
			/\b(?:cash\s*\/\s*bp|buying power|bp)\s*:/i,
			/\bpositions?\s*:/i
		];
		return (
			signals.filter((pattern) => pattern.test(text)).length >= 2 ||
			/\bagentic[_\s-]*allowed\b/i.test(text)
		);
	}

	function sanitizeOverview(text: string): string {
		return text
			.replace(/\bagentic[_\s-]*allowed\b/gi, '')
			.replace(/\bagentic\b/gi, '')
			.replace(/\baccount\s*(?:number|no\.?|id)?\s*[:#]?\s*[•*xX\d-]{4,}\b/gi, '')
			.replace(/\([^)]*(?:[•*xX]{2,}|\d{4})[^)]*\)/g, '')
			.replace(/\baccount\s*:\s*/gi, '')
			.replace(/\s{2,}/g, ' ')
			.replace(/^[\s,;|:—–-]+|[\s,;|:—–-]+$/g, '')
			.trim();
	}

	const accountSnapshot = $derived(section(runLog, ['account snapshot']));
	const snapshotText = $derived(accountSnapshot.join(' | '));
	const portfolioValue = $derived(
		matchMoney(snapshotText, /\b(?:equity|portfolio value)\s*:\s*~?\$([\d,.]+)/i)
	);
	const buyingPower = $derived(
		matchMoney(snapshotText, /\b(?:cash\s*\/\s*bp|buying power|bp)\s*:\s*~?\$([\d,.]+)/i)
	);
	const parsedPositionCount = $derived(
		numberValue(snapshotText.match(/\bpositions?\s*:\s*(\d+)/i)?.[1])
	);
	const positionLines = $derived.by(() => {
		const listed = section(runLog, ['positions', 'current positions']);
		if (listed.length > 0) return listed;
		const weights = accountSnapshot.find((line) => /^approx(?:imate)? weights:/i.test(line));
		return weights
			? weights
					.replace(/^approx(?:imate)? weights:\s*/i, '')
					.split('|')
					.map((line) => line.trim())
					.filter(Boolean)
			: [];
	});
	const holdings = $derived(
		positionLines.map(parseHolding).filter((holding): holding is Holding => holding !== null)
	);
	const positionCount = $derived(parsedPositionCount ?? (holdings.length > 0 ? holdings.length : null));
	const overview = $derived.by(() => {
		const narrative = [
			...section(runLog, ['overview']),
			...section(runLog, ['rationale', 'brief rationale']),
			...section(runLog, ['actions taken', 'actions this run', 'actions'])
		]
			.filter((line) => !isRawAccountMetadata(line))
			.map(sanitizeOverview)
			.find((line) => line.length >= 12);
		if (narrative) return narrative.split(/(?<=[.!?])\s+/)[0].slice(0, 240);
		if (positionCount !== null && buyingPower !== null) {
			return `${positionCount} positions are currently tracked with ${formatMoney(buyingPower)} available to deploy.`;
		}
		if (positionCount !== null) return `${positionCount} positions are currently tracked.`;
		if (buyingPower !== null) return `${formatMoney(buyingPower)} is currently available to deploy.`;
		return '';
	});
	const symbols = $derived(holdings.map((holding) => holding.symbol));
	const quoteMap = $derived(
		new Map((quoteResult?.quotes ?? []).map((quote) => [quote.symbol, quote]))
	);
	const displayHoldings = $derived(
		holdings.map((holding) => {
			const quote = quoteMap.get(holding.symbol) ?? null;
			const price = quote?.price ?? holding.loggedPrice;
			const value =
				quote && holding.quantity !== null
					? quote.price * holding.quantity
					: (holding.loggedValue ??
						(portfolioValue !== null && holding.weight !== null
							? portfolioValue * (holding.weight / 100)
							: null));
			return {
				...holding,
				quote,
				price,
				value,
				valueIsApproximate:
					holding.loggedValue === null &&
					!(quote && holding.quantity !== null) &&
					portfolioValue !== null &&
					holding.weight !== null,
				dayChange: quote?.change ?? holding.loggedDayChange,
				dayPercent: quote?.changePercent ?? holding.loggedDayPercent
			};
		})
	);
	const quoteFreshness = $derived.by(() => {
		if (!quoteResult) return symbols.length > 0 ? 'Loading' : 'No symbols';
		if (quoteResult.quotes.length === 0) return 'Unavailable';
		const latest = Math.max(
			...quoteResult.quotes.map((quote) => quote.asOf ?? quoteResult.fetchedAt)
		);
		return `${marketLabel(quoteResult.quotes[0]?.marketState ?? null)} · ${timeLabel(latest)}`;
	});
	const focus = $derived(
		section(runLog, ['open watch / follow-ups', 'open watch', 'follow-ups', 'carry-forward'])
	);
	const activity = $derived.by(() => {
		const entries = changelog
			.split(/\r?\n/)
			.map(cleanLine)
			.filter((line) => line && !/^#+\s/.test(line));
		return entries.length > 0 ? entries.slice(0, 12) : section(runLog, ['actions taken', 'actions']);
	});

	async function refreshQuotes() {
		const api = getBackend();
		if (!api || symbols.length === 0) {
			quoteResult = null;
			return;
		}
		const request = ++quoteRequest;
		try {
			const result = await api.getEquityQuotes(symbols);
			if (request === quoteRequest) quoteResult = result;
		} catch {
			if (request === quoteRequest && !quoteResult) {
				quoteResult = { quotes: [], fetchedAt: Date.now() };
			}
		}
	}

	async function loadDashboard() {
		const api = getBackend();
		if (!api) {
			loadError = 'Not running inside Electron — start with pnpm start from ui/';
			loading = false;
			return;
		}
		try {
			const [latestRunLog, latestChangelog] = await Promise.all([
				api.readRepoFile('run-log.md'),
				api.readRepoFile('changelog.md')
			]);
			runLog = latestRunLog ?? '';
			changelog = latestChangelog ?? '';
			loadError = null;
			void refreshQuotes();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const api = getBackend();
		void loadDashboard();
		if (!api) return;
		const refreshTimer = window.setInterval(() => {
			void refreshQuotes();
		}, 60_000);
		const unsubscribe = api.onRunEvent((event) => {
			if (event.type === 'status' && event.status.state !== 'running') {
				void loadDashboard();
			}
		});
		return () => {
			window.clearInterval(refreshTimer);
			unsubscribe();
		};
	});
</script>

<title>auto-rob</title>

<main class="bg-background text-on-background min-h-dvh px-6 pt-12 pb-28">
	{#if loadError}
		<p class="text-error mt-6 max-w-lg text-sm">{loadError}</p>
	{/if}

	<div class="mt-8">
		<section
			class="border-outline/40 grid gap-5 border-b pb-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)] lg:items-end"
			aria-labelledby="overview-title"
		>
			<div>
				<p class="text-on-surface-variant text-xs font-semibold tracking-[0.16em] uppercase">
					Overview
				</p>
				<h2
					id="overview-title"
					class="text-on-surface mt-3 max-w-3xl text-xl leading-snug font-semibold sm:text-2xl"
				>
					{overview || (loading ? 'Loading account status…' : 'No account summary yet')}
				</h2>
			</div>
			<dl class="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 lg:grid-cols-2">
				<div class="border-outline/30 border-l pl-3">
					<dt class="text-on-surface-variant text-xs">Portfolio value</dt>
					<dd class="text-on-surface mt-1 text-base font-semibold tabular-nums">
						{formatMoney(portfolioValue)}
					</dd>
				</div>
				<div class="border-outline/30 border-l pl-3">
					<dt class="text-on-surface-variant text-xs">Buying power</dt>
					<dd class="text-on-surface mt-1 text-base font-semibold tabular-nums">
						{formatMoney(buyingPower)}
					</dd>
				</div>
				<div class="border-outline/30 border-l pl-3">
					<dt class="text-on-surface-variant text-xs">Positions</dt>
					<dd class="text-on-surface mt-1 text-base font-semibold tabular-nums">
						{positionCount ?? '—'}
					</dd>
				</div>
				<div class="border-outline/30 border-l pl-3">
					<dt class="text-on-surface-variant text-xs">Quote freshness</dt>
					<dd class="text-on-surface mt-1 text-sm font-semibold">{quoteFreshness}</dd>
				</div>
			</dl>
		</section>

		<div class="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
			<section
				class="bg-surface-container-high ring-outline/40 min-h-[26rem] rounded-2xl p-5 ring-1 sm:p-6"
				aria-labelledby="positions-title"
			>
				<div class="flex items-end justify-between gap-4">
					<div>
						<p class="text-on-surface-variant text-xs font-semibold tracking-[0.16em] uppercase">
							Positions
						</p>
						<h2 id="positions-title" class="text-on-surface mt-1 text-xl font-semibold">
							Current holdings
						</h2>
					</div>
					<p class="text-on-surface-variant/70 text-right text-xs">Latest agent snapshot</p>
				</div>
				{#if displayHoldings.length > 0}
					<ul class="mt-6 grid gap-3 sm:grid-cols-2">
						{#each displayHoldings as holding (holding.symbol)}
							<li
								class="bg-surface-container-low ring-outline/25 rounded-xl p-4 ring-1"
							>
								<div class="flex items-start justify-between gap-4">
									<div>
										<p class="text-on-surface text-lg font-semibold tracking-wide">
											{holding.symbol}
										</p>
										<p class="text-on-surface mt-2 text-xl font-semibold tabular-nums">
											{formatMoney(holding.price)}
										</p>
									</div>
									<p class="text-on-surface-variant max-w-28 text-right text-xs leading-relaxed">
										{holding.quote
											? `${marketLabel(holding.quote.marketState)} · ${timeLabel(holding.quote.asOf ?? quoteResult?.fetchedAt ?? Date.now())}`
											: holding.loggedPrice !== null
												? 'Last run price'
												: 'Quote unavailable'}
									</p>
								</div>
								<div class="border-outline/25 mt-4 grid grid-cols-2 gap-4 border-t pt-3">
									<div>
										<p class="text-on-surface-variant text-xs">Price move</p>
										<p
											class={[
												'mt-1 text-sm font-semibold tabular-nums',
												holding.dayChange === null
													? 'text-on-surface-variant'
													: holding.dayChange >= 0
														? 'text-tertiary'
														: 'text-error'
											]}
										>
											{holding.dayChange === null
												? 'Unavailable'
												: `${formatSignedMoney(holding.dayChange)} · ${formatPercent(holding.dayPercent)}`}
										</p>
									</div>
									<div class="text-right">
										<p class="text-on-surface-variant text-xs">Position value</p>
										<p class="text-on-surface mt-1 text-sm font-semibold tabular-nums">
											{formatMoney(holding.value)}
											{holding.valueIsApproximate ? ' approx.' : ''}
										</p>
									</div>
								</div>
								{#if holding.quantity !== null || holding.weight !== null}
									<div class="text-on-surface-variant mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
										{#if holding.quantity !== null}
											<span>{holding.quantity.toLocaleString()} shares</span>
										{/if}
										{#if holding.weight !== null}
											<span>{holding.weight.toFixed(1)}% weight</span>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-on-surface-variant/70 mt-6 text-sm">
						{loading ? 'Loading positions…' : 'No position snapshot recorded yet.'}
					</p>
				{/if}
			</section>

			<div class="grid min-h-0 gap-4 lg:grid-rows-[minmax(20rem,1fr)_auto]">
				<section
					class="bg-surface-container-high ring-outline/40 flex min-h-[20rem] flex-col rounded-2xl p-5 ring-1"
					aria-labelledby="activity-title"
				>
					<p class="text-on-surface-variant text-xs font-semibold tracking-[0.16em] uppercase">
						Activity
					</p>
					<h2 id="activity-title" class="text-on-surface mt-1 text-lg font-semibold">
						Recent changes
					</h2>
					{#if activity.length > 0}
						<ol class="mt-5 min-h-0 overflow-y-auto pl-1">
							{#each activity as entry (entry)}
								<li
									class="border-outline/35 relative border-l pb-5 pl-5 last:border-transparent last:pb-0"
								>
									<span
										class="bg-primary ring-surface-container-high absolute top-1 -left-1 size-2 rounded-full ring-4"
										aria-hidden="true"
									></span>
									<p class="text-on-surface text-sm leading-relaxed">{entry}</p>
								</li>
							{/each}
						</ol>
					{:else}
						<p class="text-on-surface-variant/70 mt-5 text-sm">
							{loading ? 'Loading activity…' : 'No account changes recorded yet.'}
						</p>
					{/if}
				</section>

				<section
					class="bg-surface-container-low ring-outline/30 rounded-2xl p-5 ring-1"
					aria-labelledby="focus-title"
				>
					<p class="text-on-surface-variant text-xs font-semibold tracking-[0.16em] uppercase">
						Next focus
					</p>
					<h2 id="focus-title" class="text-on-surface mt-1 text-base font-semibold">
						What the agent is watching
					</h2>
					{#if focus.length > 0}
						<ul class="text-on-surface-variant mt-4 space-y-2 text-sm">
							{#each focus.slice(0, 3) as item (item)}
								<li>{item}</li>
							{/each}
						</ul>
					{:else}
						<p class="text-on-surface-variant/70 mt-4 text-sm">No follow-ups recorded.</p>
					{/if}
				</section>
			</div>
		</div>
	</div>
</main>
