// atom manifest: wraps dereverb.js per @audio/compile CONTRACT. The prediction is fitted over the whole take (the room
// is one for all of it, the voice is not), so it needs the whole clip: streaming: false, as dehum and debreath; the
// host hands it the input in one block. Each channel is fitted on its own.

import dereverb_ from './dereverb.js'

export const dereverb = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) out[c].set(dereverb_(inp[c], { fs: ctx.sampleRate, strength: params.strength[0], music: params.music }))
	}
}
dereverb.channels = 'any'
dereverb.streaming = false
dereverb.tail = 0
dereverb.params = {
	strength: { type: 'number', min: 0, max: 4, default: 1 },   // the late estimate's scale (1: as the take's own decays read it); 0: the linear prediction alone
	music: { type: 'enum', values: ['pass', 'enhance'], default: 'pass' },   // 'pass': a take with a held partial or a beat comes back as it went; 'enhance': taken as a room too
}
