# @audio/denoise-desqueak [![npm](https://img.shields.io/npm/v/@audio/denoise-desqueak)](https://www.npmjs.com/package/@audio/denoise-desqueak) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Guitar de-noise: string squeaks taken down where a finger slides on a wound string, the notes left as they ring; a pick's harsh attack softened, the amp's hiss and buzz taken down, on request

```
npm install @audio/denoise-desqueak
```

```js
import desqueak from '@audio/denoise-desqueak'
```

Three parts, as iZotope RX's Guitar De-noise has; squeak on by default, pick and amp when given a level. Where a part finds nothing, the take comes back sample for sample (the amp part, once on, reworks the whole take).

**Squeak.** A fingertip sliding along a wound string strikes each winding it crosses: a pulse train at v/d, the slide's speed over the winding's pitch, so a comb of harmonics that rises and falls with the hand's move, an RMS that grows with the speed, and static lines at the string's longitudinal modes (Pakarinen, Penttinen & Bank, JASA 122(6), EL197–EL202, 2007). It is told from the guitar by what a note is not. A note's partials hold their bins: harmonic in Driedger, Müller & Disch's split (ISMIR 2014), a cell's median over ±100 ms 6 dB over its median over ±350 Hz, read on frames four times as long as the squeak's (93 ms at 44.1 kHz, 10.8 Hz bins), where a bass note's partials 82 Hz apart stand apart and a sweeping comb smears; on the short frames they merged into what read as noise, and the cut took a bass note's upper partials. A squeak lifts the part of 1–10 kHz that is not harmonic and none of the harmonic part, so their ratio, which a note keeps as it decays, rises: a squeak's frames have it 14 dB or more over the least it reaches in the 200 ms before and in the 200 ms after, 70 % or more of the band not harmonic, 10 dB or more over the band's quiet. A note's start is not a squeak: three or more third-octave bands from 80 to 560 Hz staying 6 dB up for 30 ms, to within 15 dB of their loud frames (a pluck's click and low partials; a squeak's comb passes through a band and stays far under a note), or partials arriving that hold 50 ms (a chord struck again raises its own ringing partials 4.5 dB; a squeak's comb moves on, and its longitudinal lines are a few, where a chord brings 16 bins or more over 1 kHz). A region with a note starting in its first half is that note's attack. A squeak is a contact held while the hand moves, so a region stands 45 ms or more, its 1–10 kHz energy spread over 15 ms or more and never jumping 16 dB within a millisecond (a click rises at once, a squeak with the hand's speed): on the tuning takes real squeaks ran 46–134 ms, and the pick's touch before a pluck, which the other cues let through, 12–35 ms. A slow slide holds its comb still for tens of ms at a time, steps that read as partials even on short frames (a held note's partial and a still step are the same to any test of a cell; what differs is that the step is there only inside the squeak): a shorter run is widened over the band's rise, up to 30 ms either way, and kept if it is a comb, its 1–8 kHz spectrum peaky (spectral flatness 0.1 or under: real squeaks 0.063 on the tuning takes, the plucks, strums and touches 0.179). In a region every bin over 300 Hz goes down to what it holds just outside the region (the lesser side's mean over 4 frames), `squeak` dB at most; a harmonic cell is left, but in a comb's region cut to 6 dB over the greater side, which a note ringing through, starting or stopping keeps and a slide's still step does not; on 23 ms frames (1024 at 44.1 and 48 kHz); the edit is confined to the region with 2 ms edges, as the take is rebuilt as x − m·ISTFT((1 − G)·X), so everything else stays sample for sample.

**Pick.** A pluck's click: a 2–10 kHz millisecond 9 dB or more over the quietest 4 ms of the 40 ms before it (a strum's strings click one after another, each over the last), the loudest within 20 ms. Its attack, from 2 ms before to `attack` after (10 ms), is taken down on 5.8 ms frames, each bin over 1.5 kHz to the level the note holds 15–35 ms on, `pick` dB at most: the click goes, the partials that ring on stay.

**Amp.** The buzz first: its lines are locked to the mains, so they are subtracted, each held through the take ([`dehum`](#dehum) with `steady`: one phasor per line, the mains phase refined against them; no hum found, nothing changed), where a gain cannot part a buzz line from a partial in its bin. Then OM-LSA (`@audio/denoise-omlsa`, the held-noise form: Gerkmann, Breithaupt & Martin 2008) on a print read from the take's quietest frames: those within 1 dB of its 1st-percentile frame (the amp alone before the playing, where the take has that, else the gaps), split in time into four groups, per bin their mean, or where the groups' means spread over 6 dB (a note rang into some), the least group's ×1.5. A spectral peak 10 dB or more over the print keeps its level, with its main lobe: a note ringing on is peaks well over the noise, where hiss peaks so high in one bin in 22 000 and a buzz's line sits at the print. OM-LSA alone took the last chord of a take, 22 dB over the hiss, 6 dB down.

```js
desqueak(data, { fs: 44100 })                         // squeaks, up to 30 dB down
desqueak(data, { fs: 44100, pick: -9, amp: -20 })     // and harsh picks, and the amp's hiss and buzz
desqueak(data, { fs: 44100, squeak: 0, amp: -20 })    // the amp's noise alone
```

| Param | Default | |
|---|---|---|
| `squeak` | `-30` | dB, the most a squeak goes down; `0` leaves squeaks |
| `pick` | `0` | dB, the most a pick's attack goes down; `0` off; `-9` restores attacks made 6–12 dB harsher |
| `attack` | `0.01` | s, the pick's attack taken, from 2 ms before its click |
| `amp` | `0` | dB, how far the amp's hiss goes down, and what the subtraction leaves of its hum and buzz; `0` off; `-20` typical |

The whole take is read at once (streaming: false); about 20× real time at 44.1 kHz on one core.

Measured against iZotope RX 12 Guitar De-noise (`node bench/rx/guitar.mjs test` in [audio](https://github.com/audiojs/audio), 2026-10): GuitarSet's mic takes (Xi et al., ISMIR 2018, CC BY 4.0), a solo acoustic guitar; every setting, ours and RX's, chosen on players 00–02 (30 takes), test on players 03–05 (30 takes, 12.1 min). RX through its plugin, at its defaults (Squeak on, sensitivity 3, reduction 4) and each part tuned by SNR on the tuning takes, the others bypassed. The takes hold squeaks of their own, so harm is read on the notes: per annotated note, its partials up to 10 kHz where they stand 10 dB clear, in its first 40 ms (attack) and after (sustain), the share changed by over 1 dB.

Squeaks synthesized from their physics and added to the takes (290 on test): a pulse per winding crossed (0.16–0.44 mm, the wrap wire of a light phosphor-bronze set), the hand's speed rising and falling as a minimum-jerk move (Flash & Hogan 1985) to 0.15–1.5 m/s over 40–300 ms, a resonator on the firing rate and the string's longitudinal modes (1.4–2.0 kHz) as Pakarinen, Välimäki & Puputti's slide guitar model has it (NIME 2008), ending 5–40 ms before a position shift's note or anywhere, peaking 10–30 dB under the take's loud frames. The error to the clean take gone over each squeak, pooled and median; its own time-frequency cells; SNR to the take (the input's 25.2 dB); on the clean takes, the samples moved and the notes' partials moved:

| | squeak gone, pooled · median (dB) | its cells (dB) | SNR (dB) | elsewhere (dB under) | clean: samples moved | attacks · sustains moved, over 1 kHz | under 1 kHz |
|---|---:|---:|---:|---:|---:|---:|---:|
| RX 12, defaults (= tuned) | 2.7 · 2.8 | 4.3 | 20.5 | 21.2 | 12.9 % | 1.4 % · 3.2 % | 0.1 % · 0.1 % |
| `desqueak()` | 3.3 · 2.6 | 4.9 | 23.2 | 24.4 | 2.4 % | 2.2 % · 2.8 % | 0.1 % · 0.0 % |

Squeaks as recorded: where RX's squeak detector and ours (0.1.0) both mark something on the takes, looked at on spectrograms; a squeak where a sweep shows (an arch, a stacked comb), not where a pluck, a strum or a click shows with partials after it. Per event, its 1–10 kHz energy taken, median and the share taken by 3 dB or more (squeaks) or by 1 dB or more (not squeaks):

| | tune: squeaks (14) | not (58) | test: squeaks (35) | not (47) |
|---|---:|---:|---:|---:|
| RX 12, defaults | 9.8 | 2.9 | 13.5 · 94 % | 3.7 · 96 % |
| `desqueak()` 0.1.0 | 10.9 | 0.0 | 9.0 · 74 % | 4.4 · 51 % |
| `desqueak()` | 11.1 | 0.0 | 12.8 · 86 % | 4.4 · 51 % |

0.1.0 took nothing from six of the test's 35 and under 3 dB from three more: slow slides (70–150 ms) whose comb holds still for tens of ms at a time, so their non-harmonic run fell under 45 ms and their still steps, read as partials, were spared (03_SS1 solo at 0.94 s: 100 ms, RX 25.6 dB, 0.1.0 0.0). 0.2.0 widens such a run over the band's rise and keeps it if a comb, and cuts a still step that exists only inside the squeak; the plucks and touches keep their row. RX still takes 0.7 dB more at the median, and five of the 35 lose under 3 dB to ours (a 23 ms one stays under the minimum). Ours touches half the plucks and clicks RX touches nearly all of, a little deeper where it does (4.4 against 3.7 dB median). Partials tried as tracks instead (peaks held within ±1 bin for 120 ms on 46 ms frames, or within 6 dB) read a slow slide's still steps, and the noise around them, as partials too, and missed the squeaks they were for (test 0.1 dB taken).

Picks made harsh: each attack's 2–10 kHz raised 6–12 dB over its first 10 ms (2224 on test), the take as played the target; the boost's error gone, pooled and median; the band left over the take's own; SNR (the input's 17.1 dB); on the clean takes, the notes' partials moved:

| | harshness gone, pooled · median (dB) | 2–10 kHz left (dB) | SNR (dB) | elsewhere (dB under) | clean: attacks under 1 kHz · sustains over · under |
|---|---:|---:|---:|---:|---:|
| RX 12, Pick on at its defaults | 1.6 · 1.3 | 5.1 | 16.9 | 20.1 | 3.2 % · 6.2 % · 0.9 % |
| RX 12, Pick tuned (sensitivity 2, attack 0.1, reduction 5) | 3.3 · 0.7 | 6.3 | 19.3 | 24.6 | 0.8 % · 2.3 % · 0.1 % |
| `desqueak({ squeak: 0, pick: -9 })` | 8.9 · 10.5 | 1.2 | 24.1 | 27.3 | 0.0 % · 3.8 % · 0.0 % |

Amp noise under the takes, from a second before them: hiss (white through a cabinet's 80 Hz–5 kHz) 40 dB under the take, buzz (60 Hz, odd-heavy to 8 kHz: Whitlock's ground-loop and rectifier buzz, as audio's dehum bench has it) 35 dB under, and both 40 dB under. By phase inversion (Hagerman & Olofsson 2004): the noise taken where it is heard (10 ms frames where the guitar stands under 6 dB over it) and over the take, the guitar's SDR, SNR, the notes' partials over 1 kHz moved. RX's Amp section learns from its Learn button alone, no plugin parameter: hosted, it passes the take bit for bit at every setting. RX 12 Spectral De-noise learned on the second of noise stands in for it, at its defaults and tuned (Extreme, 20 dB):

| | hiss: heard · over · SDR · SNR (dB) | sustains moved | buzz | sustains moved | both | sustains moved |
|---|---:|---:|---:|---:|---:|---:|
| RX 12 Guitar De-noise, Amp on | 0.0 · 0.0 · ∞ · 40.0 | 0.0 % | 0.0 · 0.0 · ∞ · 35.0 | 0.0 % | 0.0 · 0.0 · ∞ · 37.0 | 0.0 % |
| RX 12 Spectral De-noise, learned | 7.4 · 1.2 · 48.8 · 40.5 | 2.0 % | 6.3 · 1.1 · 48.0 · 35.8 | 2.5 % | 5.5 · 0.9 · 48.5 · 37.5 | 2.5 % |
| same, tuned | 10.3 · 2.0 · 47.9 · 41.0 | 3.7 % | 9.5 · 2.3 · 44.5 · 36.6 | 4.2 % | 8.0 · 1.6 · 46.7 · 38.0 | 4.6 % |
| `desqueak({ squeak: 0, amp: -20 })` 0.2.0 | 11.8 · 2.5 · 49.2 · 41.7 | 1.6 % | 9.5 · 2.3 · 43.1 · 36.3 | 1.3 % | 8.6 · 1.9 · 42.6 · 37.3 | 1.9 % |
| `desqueak({ squeak: 0, amp: -20 })` | 11.8 · 2.5 · 49.2 · 41.7 | 1.6 % | 13.1 · 9.3 · 47.3 · 42.8 | 0.0 % | 9.8 · 3.4 · 44.8 · 39.0 | 1.7 % |

Under hiss ours is ahead on every count, as 0.2.0 was. Under buzz 0.2.0 trailed in the guitar's SDR (43.1 against 44.5 dB): in the takes' quiet passages, where the guitar plays 5–8 dB over the buzz, and on the lines, where a gain cannot part a buzz harmonic from a partial in its bin (about half the guitar's error lay within ±10 Hz of the 60 Hz lines, a third by chance). 0.3.0 subtracts the lines first, each held through the take (`dehum` 0.6.0, `steady`): under buzz the guitar's SDR 43.1 → 47.3 dB, the buzz taken where heard 9.5 → 13.1 dB and over the take 2.3 → 9.3, the SNR 36.3 → 42.8, no sustain moved; ahead of RX on every count. Under buzz and hiss together the SDR 42.6 → 44.8, the noise where heard 8.6 → 9.8 and the SNR 37.3 → 39.0: ahead in noise taken and SNR, 1.9 dB of SDR behind RX (46.7), the hiss and what the lines leave going by gain as before. On the tuning takes, under buzz the SDR 47.6 → 54.0 dB and the buzz taken where heard 10.0 → 23.8; under both 46.6 → 47.2 and 10.7 → 10.2. Subtracting the buzz with dehum as it is for edited material (0.5.1, 0.5.2) measured worse: on the tuning takes under buzz the guitar's SDR 47.6 → 39.3 dB, the buzz 4.3 dB down. Its fit over 2 s took in the guitar's partials near the lines, and a chord's attack, moving many lines at once, read as the hum's jump (12 of them in one 25 s take), so each stretch between was fitted alone.

**Use when:** a guitar take with fret squeaks (position shifts, slides on the wound strings), attacks too sharp, or a steady amp hiss and buzz under it.<br>
**Not for:** a slide you want heard (a squeak and a slide's own comb are the same sound); noise that moves (`omlsa`, `deepfilter`).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise), the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
