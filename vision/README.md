# Mesa-Tempo · piloto de visão computacional do Mesa Atenta

Este protótipo usa um classificador pré-treinado HOG/SVM do OpenCV para **contar pessoas visíveis em uma região fixa**. Não usa reconhecimento facial, não estima tempo de espera pelo vídeo e não guarda nem envia quadros. Ângulo, iluminação, oclusões e pessoas muito próximas podem distorcer a contagem. Valide manualmente com o enquadramento real, sobretudo no horário de pico. Um único quadro não confirma um alerta: o painel mantém as regras atuais de medições repetidas.

## Testar no computador, sem conectar à operação da loja

Na raiz do repositório, com Python 3.10–3.12, use um ambiente virtual e instale:

```bash
python -m pip install -r vision/requirements.txt
python vision/contagem.py --video amostra.mp4 --local churrasqueira --zona 0.1,0.1,0.9,0.9 --leituras 5
```

Use um vídeo de teste que você tenha autorização para usar. Também é possível usar `--imagem amostra.jpg`. Sem `--publicar-local`, o script apenas imprime contagens. A zona usa coordenadas normalizadas `x1,y1,x2,y2`; ajuste ao trecho da fila.

Para ver a leitura no painel, rode `python app.py --port 8000` na raiz em outro terminal, com um SQLite reservado para o piloto. Repita o comando acrescentando `--publicar-local` e abra **http://127.0.0.1:8000/gestao**. O campo de espera permanece vazio: quantidade de pessoas não é tempo de espera.

## Depois que o restaurante autorizar o piloto

O responsável de TI da unidade identifica o modelo e o canal da câmera ou do gravador e provisiona uma conta somente leitura. Em um computador autorizado na rede local, configure `MESA_CAMERA_URL` com a URL RTSP/RTSPS indicada por ele. Não coloque a URL ou senha no GitHub, na Vercel, no chat ou na linha de comando. Rode:

```bash
python vision/contagem.py --camera --local churrasqueira --zona 0.1,0.1,0.9,0.9 --publicar-local --leituras 12
```

Compare as leituras com uma contagem humana antes de usá-las operacionalmente. Não exponha o gravador à internet. Se o equipamento não fornecer um canal compatível, mantenha o vídeo de teste ou a operação manual até confirmar outra interface autorizada. Este piloto não conecta à Vercel/Supabase, não altera o MVP publicado e não modifica as câmeras. Para uma etapa posterior, envie somente contagens por um coletor autenticado, sem transmitir imagens ou credenciais.
