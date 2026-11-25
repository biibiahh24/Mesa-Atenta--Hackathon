# Demonstração e entrega

Abra Gestão, Salão e Mesa 07. Para gravar, use o banco simulado gerado pelo comando do README. No trecho do alerta, salve a ação e registre uma leitura de recuperação. Se quiser mostrar o encerramento, registre uma segunda leitura abaixo do limite 45 a 90 s depois e use um corte no vídeo.

| Tempo | Mostrar |
|---|---|
| 0:00–0:15 | Unidade Augusta e as dores do almoço por peso. |
| 0:15–0:40 | Alerta da churrasqueira, ciência do gerente, intervenção e medição posterior. |
| 0:40–1:05 | Cliente chama na mesa 07, equipe assume e conclui. |
| 1:05–1:25 | Equipe assume a limpeza da mesa 12 e marca como pronta. |
| 1:25–1:55 | Pesagem amostral, registro de sobra/comentário e comparação após ação no buffet. |

No pitch de até quatro minutos, preserve essa sequência e use o tempo adicional para explicar o papel de cada tela e a leitura dos indicadores. A FMU informa que as perguntas vêm depois do pitch.

## Testes executados

Para repetir a verificação a partir da raiz do repositório, execute `python3 -m tests.verify_http`. No Windows, use `py -m tests.verify_http`.

O teste executa o servidor HTTP com SQLite temporário. Foram verificados os seguintes fluxos.

- Páginas de Mesa, Salão e Gestão e seus recursos servidos com HTTP 200.
- Atendimento da mesa 07 até conclusão. Reenvio preservou o chamado e concluir antes de assumir foi bloqueado.
- Oito sinalizações concorrentes da mesma mesa geraram uma tarefa. Um dos dois operadores concorrentes conseguiu assumir a limpeza. A API rejeitou mesa inválida e conclusão antes de assumir.
- Medições repetidas acima do limite geraram um aviso, seguido de ciência, intervenção, recuperação e encerramento. Comparação de espera retornou medianas de 450 s antes e 210 s depois, com duas amostras em cada período simulado. A leitura vencida foi sinalizada.
- Mix, sobra, comentário e ação foram registrados. Sobra acima da amostra foi rejeitada. Reenvio do mesmo registro foi deduplicado e o estado persistiu ao reinicializar o banco.
- Carga do almoço simulado gerou o aviso, a tarefa de limpeza e os registros do buffet. Checagens de sintaxe Python e JavaScript passaram.

## Conferência antes de enviar

- [x] Código, documentação, instruções de execução, esquema, diagrama e apresentação.
- [ ] Validar o fluxo visual completo em navegador.
- [ ] Incluir até cinco capturas da versão executável.
- [ ] Gravar e incluir o link do vídeo de até dois minutos. Conferir acesso sem login.
- [ ] Publicar GitHub e testar em janela anônima. Manter público durante a avaliação.
- [ ] O líder envia o link até 26/11/2026 às 12h pelo [Forms oficial](https://forms.cloud.microsoft/r/ZFk82fpieq).
- [ ] Acompanhar o e-mail até as 16h. Final a partir das 19h.

A prévia gerenciada falhou na abertura da rota do navegador. A verificação visual e a gravação seguem pendentes.
