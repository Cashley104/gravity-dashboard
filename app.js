const manifestUrl = './data/dashboard_manifest.json';
const RAW_MIN_TEAMMATE_FGA = 250;
const ADJUSTED_MIN_WOWY_FGA = 25;
const ADJUSTED_MIN_SHARED_MINUTES = 10;
const ADJUSTED_MIN_TOTAL_FGA_WITH = 150;

const summaryCards = document.getElementById('summary-cards');
const metricView = document.getElementById('metric-view');
const statView = document.getElementById('stat-view');
const explainToggle = document.getElementById('explain-toggle');
const explainPanel = document.getElementById('explain-panel');
const explainTitle = document.getElementById('explain-title');
const explainText = document.getElementById('explain-text');
const explainFormula = document.getElementById('explain-formula');
const teamFilter = document.getElementById('team-filter');
const positionFilter = document.getElementById('position-filter');
const searchFilter = document.getElementById('search-filter');
const minutesFilter = document.getElementById('minutes-filter');
const statusBanner = document.getElementById('status-banner');
const heroSubhead = document.getElementById('hero-subhead');
const positiveTitle = document.getElementById('positive-title');
const negativeTitle = document.getElementById('negative-title');
const positiveSubhead = document.getElementById('positive-subhead');
const negativeSubhead = document.getElementById('negative-subhead');

let manifest = null;
let currentDataset = null;
let currentSeasonEntry = null;
let sharedEligiblePlayerIds = new Set();
let adjustedThreeLookup = null;
let teammateWowyPromise = null;
let teammateWowyPrefetched = false;

function setStatus(message, tone = 'info') {
  if (tone === 'error') {
    statusBanner.textContent = message;
    statusBanner.dataset.tone = tone;
    statusBanner.hidden = false;
    return;
  }
  statusBanner.textContent = '';
  statusBanner.dataset.tone = tone;
  statusBanner.hidden = true;
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function formatNum(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number(value).toFixed(digits);
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort();
}

function uniquePositionValues(rows) {
  const values = new Set();
  rows.forEach((row) => {
    const raw = String(row.target_position_search || row.target_position || '').split('|');
    raw.map((value) => value.trim()).filter(Boolean).forEach((value) => values.add(value));
  });
  const order = new Map([
    ['G', 0],
    ['F', 1],
    ['C', 2],
  ]);
  return [...values].sort((a, b) => {
    const rankA = order.has(a) ? order.get(a) : 99;
    const rankB = order.has(b) ? order.get(b) : 99;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

function populateSelect(selectEl, values, allLabel) {
  const current = selectEl.value;
  selectEl.innerHTML = '';
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = allLabel;
  selectEl.appendChild(allOption);
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  });
  if ([...selectEl.options].some((option) => option.value === current)) {
    selectEl.value = current;
  }
}

function activeRows() {
  if (!currentDataset) return [];
  const rows = metricView.value === 'adjusted'
    ? (currentDataset.player_adjusted_wowy_summary || [])
    : (currentDataset.player_onoff_summary || []);
  return rows.filter((row) => sharedEligiblePlayerIds.has(String(row.target_player_id)));
}

function currentMetricLabel() {
  return statView.value === 'three' ? '3P%' : 'eFG%';
}

function currentModeLabel() {
  return metricView.value === 'adjusted' ? 'Adjusted' : 'Delta';
}

function displayPlayerName(name) {
  return name ? String(name) : 'Unknown Player';
}

function renderExplanation() {
  const metricLabel = currentMetricLabel();
  if (metricView.value === 'adjusted') {
    explainTitle.textContent = `Adjusted WOWY ${metricLabel} Explained`;
    if (statView.value === 'three') {
      explainText.textContent = "Adjusted WOWY (With or Without You) 3P% compares each teammate's 3P% with the player on the court versus that same teammate's own 3P% without the player. That normalizes for teammate quality by comparing each teammate to his own baseline instead of using one combined teamwide shooting percentage.";
      explainFormula.textContent = 'Adjusted 3P% =\n\u03A3((teammate 3P% with player - teammate 3P% without player) \u00D7 teammate 3PA with player)\n/ \u03A3(teammate 3PA with player)';
    } else {
      explainText.textContent = "Adjusted WOWY (With or Without You) eFG% compares each teammate's eFG% with the player on the court versus that same teammate's own eFG% without the player. That normalizes for teammate quality by comparing each teammate to his own baseline instead of using one combined teamwide shooting percentage.";
      explainFormula.textContent = 'Adjusted eFG% =\n\u03A3((teammate eFG% with player - teammate eFG% without player) \u00D7 teammate FGA with player)\n/ \u03A3(teammate FGA with player)';
    }
    return;
  }

  explainTitle.textContent = `Raw ${metricLabel} Delta Explained`;
  if (statView.value === 'three') {
    explainText.textContent = 'Raw 3P% Delta compares the teamwide 3P% with the player on the court versus the teamwide 3P% with the player off the court, excluding the target player\'s own shots. It is a direct team-level on/off split, not a teammate-by-teammate baseline adjustment.';
    explainFormula.textContent = '3P% \u0394 = teammate 3P% while on the court - teammate 3P% while off the court\nexcluding the target player\'s own shots';
  } else {
    explainText.textContent = 'Raw eFG% Delta compares the teamwide eFG% with the player on the court versus the teamwide eFG% with the player off the court, excluding the target player\'s own shots. It is a direct team-level on/off split, not a teammate-by-teammate baseline adjustment.';
    explainFormula.textContent = 'eFG% \u0394 = teammate eFG% while on the court - teammate eFG% while off the court\nwhere eFG% = (FGM + 0.5 \u00D7 3PM) / FGA';
  }
}

function buildSharedEligibleUniverse() {
  if (!currentDataset) {
    sharedEligiblePlayerIds = new Set();
    return;
  }

  const rawEligible = new Set(
    (currentDataset.player_onoff_summary || [])
      .filter((row) => Boolean(row.meets_min_teammate_fga))
      .map((row) => String(row.target_player_id))
  );

  const adjustedEligible = new Set(
    (currentDataset.player_adjusted_wowy_summary || [])
      .filter((row) => Number(row.adjusted_total_fga_with || 0) >= ADJUSTED_MIN_TOTAL_FGA_WITH)
      .map((row) => String(row.target_player_id))
  );

  sharedEligiblePlayerIds = new Set(
    [...rawEligible].filter((playerId) => adjustedEligible.has(playerId))
  );
}

function qualifiesAdjustedPair(row) {
  return Number(row.fga_with || 0) >= ADJUSTED_MIN_WOWY_FGA
    && Number(row.fga_without || 0) >= ADJUSTED_MIN_WOWY_FGA
    && Number(row.shared_minutes_with || 0) >= ADJUSTED_MIN_SHARED_MINUTES;
}

function buildAdjustedThreeLookup() {
  if (adjustedThreeLookup !== null) return adjustedThreeLookup;
  const lookup = new Map();
  const rows = (((currentDataset && currentDataset.player_teammate_wowy) || [])).filter((row) => qualifiesAdjustedPair(row));
  const grouped = new Map();

  rows.forEach((row) => {
    const key = String(row.target_player_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  grouped.forEach((group, key) => {
    const totalFgaWith = group.reduce((sum, row) => sum + Number(row.fga_with || 0), 0);
    if (totalFgaWith < ADJUSTED_MIN_TOTAL_FGA_WITH) {
      return;
    }

    const threePaWeight = group.reduce((sum, row) => sum + Number(row.three_pa_with || 0), 0);
    if (threePaWeight <= 0) {
      lookup.set(key, {
        weighted_teammate_three_with: null,
        weighted_teammate_three_without: null,
        weighted_adjusted_three_lift: null,
      });
      return;
    }

    const weightedWith = group.reduce((sum, row) => sum + (Number(row.three_pct_with || 0) * Number(row.three_pa_with || 0)), 0) / threePaWeight;
    const weightedWithout = group.reduce((sum, row) => sum + (Number(row.three_pct_without || 0) * Number(row.three_pa_with || 0)), 0) / threePaWeight;
    const weightedLift = group.reduce((sum, row) => sum + (Number(row.delta_three_pct || 0) * Number(row.three_pa_with || 0)), 0) / threePaWeight;

    lookup.set(key, {
      weighted_teammate_three_with: weightedWith,
      weighted_teammate_three_without: weightedWithout,
      weighted_adjusted_three_lift: weightedLift,
    });
  });

  adjustedThreeLookup = lookup;
  return adjustedThreeLookup;
}

async function ensureTeammateWowyLoaded() {
  if (currentDataset && currentDataset.player_teammate_wowy) return;
  if (teammateWowyPromise) {
    await teammateWowyPromise;
    return;
  }

  const fallbackPath = currentSeasonEntry
    ? `./data/dashboard_${currentSeasonEntry.season}_wowy.json`
    : null;
  const detailPath = (currentSeasonEntry && currentSeasonEntry.wowy_data_path) || fallbackPath;
  if (!detailPath) {
    throw new Error('Adjusted WOWY detail path is not available.');
  }

  teammateWowyPromise = (async () => {
    const response = await fetch(new URL(detailPath, window.location.href));
    if (!response.ok) {
      throw new Error(`Failed to load WOWY detail: ${response.status}`);
    }
    const detailPayload = await response.json();
    currentDataset.player_teammate_wowy = detailPayload.player_teammate_wowy || [];
    adjustedThreeLookup = null;
  })();

  try {
    await teammateWowyPromise;
  } finally {
    teammateWowyPromise = null;
  }
}

function maybePrefetchTeammateWowy() {
  if (teammateWowyPrefetched || (currentDataset && currentDataset.player_teammate_wowy) || !currentSeasonEntry) return;
  teammateWowyPrefetched = true;
  window.setTimeout(() => {
    ensureTeammateWowyLoaded().catch((error) => {
      console.error(error);
    });
  }, 1200);
}

function deltaValue(row) {
  if (metricView.value === 'adjusted') {
    if (statView.value === 'three') {
      const threeRow = buildAdjustedThreeLookup().get(String(row.target_player_id));
      return Number((threeRow && threeRow.weighted_adjusted_three_lift) || 0);
    }
    return Number(row.weighted_adjusted_efg_lift || 0);
  }
  return statView.value === 'three'
    ? Number(row.delta_three_pct || 0)
    : Number(row.delta_efg_pct || 0);
}

function withValue(row) {
  if (metricView.value === 'adjusted') {
    if (statView.value === 'three') {
      const threeRow = buildAdjustedThreeLookup().get(String(row.target_player_id));
      return threeRow ? threeRow.weighted_teammate_three_with : null;
    }
    return row.weighted_teammate_efg_with;
  }
  return statView.value === 'three' ? row.three_pct_on : row.efg_pct_on;
}

function withoutValue(row) {
  if (metricView.value === 'adjusted') {
    if (statView.value === 'three') {
      const threeRow = buildAdjustedThreeLookup().get(String(row.target_player_id));
      return threeRow ? threeRow.weighted_teammate_three_without : null;
    }
    return row.weighted_teammate_efg_without;
  }
  return statView.value === 'three' ? row.three_pct_off : row.efg_pct_off;
}

function applyFilters(rows) {
  const team = teamFilter.value;
  const position = positionFilter.value;
  const search = searchFilter.value.trim().toLowerCase();
  const minMinutes = Number(minutesFilter.value || 0);

  return rows.filter((row) => {
    const teamLabel = row.display_team_abbreviation || row.team_abbreviation;
    const matchesTeam = !team || teamLabel === team;
    const positionTokens = String(row.target_position_search || row.target_position || '').split('|').map((value) => value.trim());
    const matchesPosition = !position || positionTokens.includes(position);
    const name = String(row.target_player_name || '').toLowerCase();
    const matchesSearch = !search || name.includes(search);
    const matchesMinutes = Number(row.target_sample_tracked_minutes || 0) >= minMinutes;
    return matchesTeam && matchesPosition && matchesSearch && matchesMinutes;
  });
}

function renderCards(rows) {
  const top = rows.slice().sort((a, b) => deltaValue(b) - deltaValue(a))[0];
  const low = rows.slice().sort((a, b) => deltaValue(a) - deltaValue(b))[0];
  const topText = top ? `${displayPlayerName(top.target_player_name)} (${formatPct(deltaValue(top))})` : '-';
  const lowText = low ? `${displayPlayerName(low.target_player_name)} (${formatPct(deltaValue(low))})` : '-';
  const liftLabel = `Top ${currentMetricLabel()} ${currentModeLabel()}`;
  const bottomLabel = `Bottom ${currentMetricLabel()} ${currentModeLabel()}`;
  const topNote = metricView.value === 'adjusted'
    ? `Largest teammate ${currentMetricLabel()} lift when player is on the court.`
    : `Largest teammate ${currentMetricLabel()} lift when player is on the court.`;
  const bottomNote = metricView.value === 'adjusted'
    ? `Largest teammate ${currentMetricLabel()} drop when player is on the court.`
    : `Largest teammate ${currentMetricLabel()} drop when player is on the court.`;

  const cards = [
    ['Filtered Players', rows.length, 'Rows currently shown after filters.'],
    [liftLabel, topText, topNote],
    [bottomLabel, lowText, bottomNote],
  ];

  summaryCards.innerHTML = cards.map(([title, value, note]) => `
    <article class="card">
      <p class="card-label">${title}</p>
      <p class="card-value">${value}</p>
      <p class="card-note">${note}</p>
    </article>
  `).join('');
}

function renderTable(tableId, rows, positive = true) {
  const table = document.getElementById(tableId);
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const sorted = rows.slice().sort((a, b) => positive ? deltaValue(b) - deltaValue(a) : deltaValue(a) - deltaValue(b)).slice(0, 25);
  const metricLabel = currentMetricLabel();
  if (positive) {
    positiveTitle.textContent = `Top ${sorted.length} Positive ${metricLabel} ${currentModeLabel()}`;
  } else {
    negativeTitle.textContent = `Top ${sorted.length} Negative ${metricLabel} ${currentModeLabel()}`;
  }

  if (metricView.value === 'adjusted') {
    thead.innerHTML = `
      <tr>
        <th>Player</th>
        <th>Team</th>
        <th>Pos</th>
        <th>Tracked Min</th>
        <th>Teammate ${metricLabel} With</th>
        <th>Teammate ${metricLabel} Without</th>
        <th>Adjusted ${metricLabel}</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th>Player</th>
        <th>Team</th>
        <th>Pos</th>
        <th>Tracked Min</th>
        <th>Teammate ${metricLabel} On</th>
        <th>Teammate ${metricLabel} Off</th>
        <th>${metricLabel} Delta</th>
      </tr>
    `;
  }

  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="7">No rows match the current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = sorted.map((row) => {
    if (metricView.value === 'adjusted') {
      return `
        <tr>
          <td class="player-name-cell">${displayPlayerName(row.target_player_name)}</td>
          <td>${row.display_team_abbreviation || row.team_abbreviation || 'UNK'}</td>
          <td>${row.target_position || 'UNK'}</td>
          <td>${formatNum(row.target_sample_tracked_minutes, 1)}</td>
          <td>${formatPct(withValue(row))}</td>
          <td>${formatPct(withoutValue(row))}</td>
          <td class="${deltaValue(row) >= 0 ? 'pos' : 'neg'}">${formatPct(deltaValue(row))}</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td class="player-name-cell">${displayPlayerName(row.target_player_name)}</td>
        <td>${row.display_team_abbreviation || row.team_abbreviation || 'UNK'}</td>
        <td>${row.target_position || 'UNK'}</td>
        <td>${formatNum(row.target_sample_tracked_minutes, 1)}</td>
        <td>${formatPct(withValue(row))}</td>
        <td>${formatPct(withoutValue(row))}</td>
        <td class="${deltaValue(row) >= 0 ? 'pos' : 'neg'}">${formatPct(deltaValue(row))}</td>
      </tr>
    `;
  }).join('');
}

async function rerender() {
  if (!currentDataset) return;
  if (metricView.value === 'adjusted' && statView.value === 'three') {
    try {
      await ensureTeammateWowyLoaded();
    } catch (error) {
      console.error(error);
      setStatus(`Dashboard load failed: ${error.message}`, 'error');
      return;
    }
  }
  const rows = applyFilters(activeRows());
  const metricLabel = currentMetricLabel();

  if (metricView.value === 'adjusted') {
    heroSubhead.textContent = 'Players must have 150+ teammate FGA with the player on the court. Each qualifying teammate needs 25+ teammate FGA with the player, 25+ teammate FGA without the player, and 10+ shared minutes.';
  } else {
    heroSubhead.textContent = 'Players must have 250+ teammate FGA with the player on the court and 250+ teammate FGA with the player off the court.';
  }

  if (metricView.value === 'adjusted') {
    positiveSubhead.textContent = `Sorted by adjusted ${metricLabel} relative to teammate baseline.`;
    negativeSubhead.textContent = `Lowest adjusted ${metricLabel} under the same filters.`;
  } else {
    positiveSubhead.textContent = `Sorted by ${metricLabel} relative to teammate baseline.`;
    negativeSubhead.textContent = `Lowest ${metricLabel} Delta values under the same filters.`;
  }
  setStatus('', 'success');
  renderExplanation();
  renderCards(rows);
  renderTable('positive-table', rows, true);
  renderTable('negative-table', rows, false);
  maybePrefetchTeammateWowy();
}

function repopulateFilters() {
  const rows = activeRows();
  populateSelect(teamFilter, uniqueValues(rows.map((row) => ({ team_label: row.display_team_abbreviation || row.team_abbreviation })), 'team_label'), 'All teams');
  populateSelect(positionFilter, uniquePositionValues(rows), 'All positions');
}

async function loadSeason(season) {
  const seasonEntry = manifest.seasons.find((entry) => entry.season === season);
  if (!seasonEntry) return;
  currentSeasonEntry = seasonEntry;
  const dataUrl = new URL(seasonEntry.data_path, window.location.href);
  setStatus(`Loading ${season} data...`, 'info');
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`Failed to load ${dataUrl}: ${response.status}`);
  }
  currentDataset = await response.json();
  teammateWowyPromise = null;
  adjustedThreeLookup = null;
  teammateWowyPrefetched = false;
  buildSharedEligibleUniverse();
  repopulateFilters();
  await rerender();
}

async function init() {
  try {
    const response = await fetch(new URL(manifestUrl, window.location.href));
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`);
    }
    manifest = await response.json();
    [metricView, statView, teamFilter, positionFilter, searchFilter, minutesFilter].forEach((el) => {
      el.addEventListener('input', async () => {
        if (el === metricView) {
          repopulateFilters();
        }
        await rerender();
      });
      el.addEventListener('change', async () => {
        if (el === metricView) {
          repopulateFilters();
        }
        await rerender();
      });
    });
    explainToggle.addEventListener('click', () => {
      const isOpen = !explainPanel.hidden;
      explainPanel.hidden = isOpen;
      explainToggle.setAttribute('aria-expanded', String(!isOpen));
    });
    await loadSeason(manifest.default_season);
  } catch (error) {
    console.error(error);
    setStatus(`Dashboard load failed: ${error.message}`, 'error');
  }
}

init();









