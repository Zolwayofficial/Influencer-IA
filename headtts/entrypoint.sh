#!/bin/bash
# Patch HeadTTS to pass execArgv to Worker threads for onnxruntime compatibility
sed -i "s|new Worker('./modules/worker-tts.mjs', { type: \"module\" })|new Worker('./modules/worker-tts.mjs', { type: \"module\", execArgv: ['--max-old-space-size=3072'] })|g" /app/modules/headtts-node.mjs

exec node --max-old-space-size=3072 ./modules/headtts-node.mjs
