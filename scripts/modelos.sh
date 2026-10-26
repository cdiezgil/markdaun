   # Modelo Whisper (el pequeño ~190 MB; omite este si ya funciona el large)
   mkdir -p ~/Library/Application\ Support/com.markdaun.app/whisper
   curl -L -o ~/Library/Application\ Support/com.markdaun.app/whisper/ggml-small-q5_1.bin \
     "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"

   # Modelo de embeddings (~90 MB, 5 ficheros)
   mkdir -p ~/Library/Application\ Support/com.markdaun.app/fastembed_cache/all-MiniLM-L6-v2-onnx
   BASE="https://hf-mirror.com/Qdrant/all-MiniLM-L6-v2-onnx/resolve/main"
   DIR=~/Library/Application\ Support/com.markdaun.app/fastembed_cache/all-MiniLM-L6-v2-onnx
   for f in model.onnx tokenizer.json config.json special_tokens_map.json tokenizer_config.json; do
     curl -L -o "$DIR/$f" "$BASE/$f"
   done
