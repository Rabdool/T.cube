// Wooden-board sound effects, synthesized with the Web Audio API (no audio files).
// Players can turn sounds off in Settings (stored in localStorage as ttt_sound = 'off').
const Sound = (() => {
    let ctx = null;

    function isEnabled() {
        try { return localStorage.getItem('ttt_sound') !== 'off'; } catch { return true; }
    }

    function audio() {
        if (!isEnabled()) return null;
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    // A short knock: filtered noise click plus a low body thump, like a piece set on wood.
    function knock(pitch = 1) {
        const ac = audio();
        if (!ac) return;
        const t = ac.currentTime;

        const len = Math.floor(ac.sampleRate * 0.05);
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        const noise = ac.createBufferSource();
        noise.buffer = buf;
        const band = ac.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 1100 * pitch;
        band.Q.value = 1.2;
        const nGain = ac.createGain();
        nGain.gain.value = 0.5;
        noise.connect(band).connect(nGain).connect(ac.destination);
        noise.start(t);

        const osc = ac.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(190 * pitch, t);
        osc.frequency.exponentialRampToValueAtTime(90 * pitch, t + 0.12);
        const oGain = ac.createGain();
        oGain.gain.setValueAtTime(0.35, t);
        oGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.connect(oGain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.15);
    }

    // Marimba-like tone for result jingles.
    function tone(freq, start, dur = 0.35, vol = 0.22) {
        const ac = audio();
        if (!ac) return;
        const t = ac.currentTime + start;
        [1, 4].forEach((mult, i) => {
            const osc = ac.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq * mult;
            const g = ac.createGain();
            const v = i === 0 ? vol : vol * 0.15;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(v, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 0 ? dur : dur * 0.3));
            osc.connect(g).connect(ac.destination);
            osc.start(t);
            osc.stop(t + dur + 0.05);
        });
    }

    return {
        isEnabled,
        place(sign) { knock(sign === 'X' ? 1 : 0.82); },
        win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09)); },
        lose() { [392, 329.63, 261.63].forEach((f, i) => tone(f, i * 0.14, 0.45, 0.18)); },
        draw() { [440, 440].forEach((f, i) => tone(f, i * 0.16, 0.3, 0.16)); },
    };
})();
