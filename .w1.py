import io

p = 'src/client.ts'
s = io.open(p, encoding='utf-8').read()

# 1) dictionary
if 'approveChain' not in s:
    zh = "                usageRun: '本轮',"
    assert zh in s, 'zh anchor missing'
    s = s.replace(zh, zh + "\n                approveChain: '批准并自动推进',", 1)
    en = "                usageRun: 'this run',"
    assert en in s, 'en anchor missing'
    s = s.replace(en, en + "\n                approveChain: 'Approve and continue',", 1)

# 2) the runner of the chain, next to stageAction
anchor = "      const stageAction = async (id, ordinal, action, feedback) => {"
assert anchor in s
chain = '''      /** Approve this stage, wait for the next plan, approve it too, and so on. */
      const approveChain = async (id) => {
        for (let step = 0; step < 20; step += 1) {
          const board: any = await call('list', {})
          const found = (board.tasks || []).find((entry: any) => entry.id === id)
          if (found === undefined) return
          const stages = Array.isArray(found.stages) ? found.stages : []
          const stage = stages[found.stageIndex === undefined ? 0 : found.stageIndex]
          if (stage === undefined) return
          if (stage.status === 'awaiting-approval') {
            await call('approveStage', { id, ordinal: stage.index })
            continue
          }
          if (stage.status === 'running' || stage.status === 'approved') {
            await new Promise((resolve) => setTimeout(resolve, 2000))
            continue
          }
          break
        }
        await refresh()
        setNotice({ kind: 'ok', text: t('noticeApproved') })
      }

'''
s = s.replace(anchor, chain + anchor, 1)

# 3) button: only for a waiting stage
btn_anchor = """                        awaiting
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'tc-btn tc-btn-primary',
                                onClick: () => act('approveStage', index + 1),
                              },
                              t('approve'),
                            )
                          : null,"""
assert btn_anchor in s, 'approve button block missing'
btn = btn_anchor + """
                        awaiting
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'tc-btn tc-btn-quiet',
                                'data-action': 'approve-chain',
                                onClick: () => {
                                  void props.onApproveChain(task.id)
                                },
                              },
                              t('approveChain'),
                            )
                          : null,"""
s = s.replace(btn_anchor, btn, 1)

# 4) hand it down from the page
s = s.replace("              onRun: startRun,", "              onRun: startRun,\n              onApproveChain: approveChain,", 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('approve chain wired')
