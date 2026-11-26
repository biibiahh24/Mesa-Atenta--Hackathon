# Demonstração e entrega

- [Vídeo da solução: 1min09](https://mesa-atenta-hackathon.vercel.app/video-demo) · [MP4 no GitHub](../public/mesa-atenta-demo.mp4)
- [Apresentação de cinco slides](apresentacao.pdf) · [PowerPoint](pitch.pptx) · [Roteiro](roteiro-pitch.txt)
- [Cinco capturas da versão executável](capturas/)

| Vídeo | Sequência |
|---|---|
| 0:00–0:07 | Contexto do almoço na unidade Augusta |
| 0:07–0:27 | Mesa 07 pede atendimento; Salão assume e conclui; Gestão acompanha |
| 0:27–0:36 | Salão assume a limpeza da Mesa 12 e marca a mesa pronta |
| 0:36–0:47 | Gestão confirma o aviso, registra a ação e compara a espera |
| 0:47–1:00 | Mesa-Tempo conta pessoas em vídeo de teste e envia a leitura à Gestão local |
| 1:00–1:09 | Pesagem, sobras, comentários e comparação após uma ação no buffet |

## Testes e limites

- `python3 -m tests.verify_http`: atendimento, limpeza concorrente, alertas, recuperação, buffet, idempotência e persistência com SQLite temporário.
- `node tests/verify_ui.cjs`: Mesa, Salão e Gestão em contextos de navegador independentes, com ambiente isolado. Ver instruções no README.
- A Vercel serve as três telas, que leem o Supabase de demonstração. Não se gravou dado de teste no Supabase publicado.
- O Mesa-Tempo foi validado com vídeo de teste. Não está conectado à câmera do restaurante nem roda na Vercel. A contagem não estima o tempo de espera.

O líder informa o link do GitHub público pelo [Forms da FMU](https://forms.cloud.microsoft/r/ZFk82fpieq). O repositório deve permanecer público durante a avaliação. O pitch de até quatro minutos é para as equipes finalistas.
