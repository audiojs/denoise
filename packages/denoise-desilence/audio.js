// stat manifest — silence/speech segmentation. desilence() itself changes signal
// length, so per @audio/compile CONTRACT.md it is NOT a processor atom (length-
// changing operations "are not atoms; they stay batch APIs"); this exposes the
// analysis half (`segments()`) as a stat, hosted as `a.stat('silence')`. Cutting stays
// a plain batch call — import { default as desilence } from '@audio/denoise-desilence'.

import { segments } from './desilence.js'

export const silence = {
	stat: 'silence',
	compute: (channels, { sampleRate, ...opts }) => segments(channels, { fs: sampleRate, ...opts }),
}
