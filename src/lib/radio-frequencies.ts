export type RadioFrequency = {
  id: string;
  mhz: number;
  name: string;
  category: 'Aviation' | 'Amateur radio' | 'FM radio';
  area: string;
  mode: string;
  note: string;
  source: { name: string; url: string };
  checkedOn: string;
  listening: { provider: string; url: string; coverage: string } | null;
};

const airportSource = { name: 'Broadcastify feed notes', url: 'https://www.broadcastify.com/listen/feed/47740' };
const repeaterSource = { name: 'Broadcastify feed notes', url: 'https://www.broadcastify.com/listen/feed/47504' };
const clubSource = { name: 'Ottawa Amateur Radio Club', url: 'https://oarc.net/equipment/' };
const airportListening = { provider: 'Broadcastify', url: airportSource.url, coverage: 'Shared airport feed. It monitors three frequencies; individual channels cannot be selected here.' };
const repeaterListening = { provider: 'Broadcastify', url: repeaterSource.url, coverage: 'Shared VE3OCE feed. It includes VHF and UHF; individual channels cannot be selected here.' };

// A small, sourced Ottawa directory, not a scan of the user's location or a live availability report.
// Frequencies are for receiving the listed service, rather than repeater input/transmit frequencies.
export const OTTAWA_FREQUENCIES: RadioFrequency[] = [
  { id: 'ckcu', mhz: 93.1, name: 'CKCU community radio', category: 'FM radio', area: 'Ottawa', mode: 'FM broadcast', note: 'Independent community music and spoken-word programming. Press Listen Live on the station website.', source: { name: 'CKCU 93.1 FM', url: 'https://www.ckcufm.com/' }, checkedOn: '2026-10-09', listening: { provider: 'CKCU', url: 'https://www.ckcufm.com/', coverage: 'Station stream. Its online audio may have a different delay from the FM broadcast.' } },
  { id: 'arnprior-ctaf', mhz: 122.7, name: 'Arnprior airport traffic', category: 'Aviation', area: 'Arnprior', mode: 'AM', note: 'Aircraft traffic-advisory communications, as identified by the feed operator.', source: airportSource, checkedOn: '2026-10-09', listening: airportListening },
  { id: 'carp-ctaf', mhz: 122.8, name: 'Carp airport traffic', category: 'Aviation', area: 'Carp', mode: 'AM', note: 'Aircraft traffic-advisory communications, as identified by the feed operator.', source: airportSource, checkedOn: '2026-10-09', listening: airportListening },
  { id: 'rockcliffe-ctaf', mhz: 123.5, name: 'Rockcliffe airport traffic', category: 'Aviation', area: 'Ottawa / Rockcliffe', mode: 'AM', note: 'Aircraft traffic-advisory communications, as identified by the feed operator.', source: airportSource, checkedOn: '2026-10-09', listening: airportListening },
  { id: 've3oce-vhf', mhz: 146.88, name: 'VE3OCE VHF repeater', category: 'Amateur radio', area: 'Ottawa', mode: 'Voice repeater', note: 'Public amateur-radio conversations. This is a community repeater, rather than a police channel.', source: repeaterSource, checkedOn: '2026-10-09', listening: repeaterListening },
  { id: 've2cra-vhf', mhz: 146.94, name: 'VE2CRA VHF repeater', category: 'Amateur radio', area: 'Ottawa / Gatineau', mode: 'FM', note: 'OARC lists this analog repeater in the Gatineau hills. No browser audio link has been verified for this entry; local reception needs a receiver and antenna.', source: clubSource, checkedOn: '2026-10-09', listening: null },
  { id: 've2cra-uhf', mhz: 443.3, name: 'VE2CRA UHF repeater', category: 'Amateur radio', area: 'Ottawa / Gatineau', mode: 'FM', note: 'OARC lists this analog repeater in the National Capital Region. No browser audio link has been verified for this entry; local reception needs a receiver and antenna.', source: clubSource, checkedOn: '2026-10-09', listening: null },
  { id: 've3oce-uhf', mhz: 443.8, name: 'VE3OCE UHF repeater', category: 'Amateur radio', area: 'Ottawa', mode: 'Voice repeater', note: 'Public amateur-radio conversations. This is a community repeater, rather than a police channel.', source: repeaterSource, checkedOn: '2026-10-09', listening: repeaterListening }
];

export function filterRadioFrequencies(rows: RadioFrequency[], query = '', category = 'all', availability = 'online') {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => (category === 'all' || row.category === category)
    && (availability !== 'online' || row.listening !== null)
    && terms.every(term => `${row.name} ${row.area} ${row.category} ${row.mode} ${row.mhz.toFixed(3)} ${row.listening?.provider || ''}`.toLowerCase().includes(term)));
}
