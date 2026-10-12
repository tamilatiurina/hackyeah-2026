import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const conversation = () => within(screen.getByRole('list', { name: 'Conversation' }))
const scenarios = () => within(screen.getByRole('complementary', { name: 'Scenarios' }))

async function open(id = 'agent-support') {
  const user = userEvent.setup()
  renderApp(`/agents/${id}/test`)
  await screen.findByRole('region', { name: 'Test through the guardrails' })
  return user
}

describe('Agent test step', () => {
  it('sends a message through the real test chat and shows the trace', async () => {
    const user = await open()
    expect(conversation().getByText('Send a message, or pick a scenario')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Message'), '#pii{Enter}')
    expect(await conversation().findByText('Reach me at [EMAIL] or [PHONE].')).toBeInTheDocument()
    expect(conversation().getByText('2 checks · 1 fired')).toBeInTheDocument()
    expect(conversation().getByText('Redacted')).toBeInTheDocument()
    expect(fakeApi.testChatRequests).toHaveLength(1)
    expect(fakeApi.testChatRequests[0].params.message.parts).toEqual([{ text: '#pii' }])
  })

  it('says which guardrail blocked a request', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Message'), '#inject{Enter}')
    expect(
      await conversation().findByText(/Blocked by Prompt injection detector\. The agent never saw this request\./),
    ).toBeInTheDocument()
  })

  it('completes the Test step once a reply comes back', async () => {
    const user = await open()
    expect(fakeApi.agents[0].tested).toBeUndefined()
    await user.type(screen.getByLabelText('Message'), 'hello{Enter}')
    await conversation().findByText('You said: hello')
    expect(fakeApi.agents[0].tested).toBe(true)
    const bar = within(screen.getByRole('region', { name: 'Next step' }))
    await waitFor(() => expect(bar.getByText('Tested. The trace shows what each guardrail did.')).toBeInTheDocument())
  })

  it('keeps one context per chat and starts a new one after New chat', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Message'), 'one{Enter}')
    await conversation().findByText('You said: one')
    await user.type(screen.getByLabelText('Message'), 'two{Enter}')
    await conversation().findByText('You said: two')
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    expect(conversation().queryByText('You said: one')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Message'), 'three{Enter}')
    await conversation().findByText('You said: three')
    const contexts = fakeApi.testChatRequests.map((r) => r.params.message.contextId)
    expect(contexts[0]).toBe(contexts[1])
    expect(contexts[2]).not.toBe(contexts[0])
  })

  it('flags a scenario that got through and attaches the missing guardrail', async () => {
    const user = await open('agent-contracts')
    await user.click(scenarios().getByRole('button', { name: /Personal data/ }))
    expect(
      await conversation().findByText(
        'Personal data went through unredacted. PII redaction is not attached to this agent.',
      ),
    ).toBeInTheDocument()
    expect(scenarios().getByRole('button', { name: /Personal data/ })).toHaveTextContent('✓')

    await user.click(conversation().getByRole('button', { name: 'Attach PII redaction' }))
    await waitFor(() =>
      expect(fakeApi.bindings.some((b) => b.scope_id === 'agent-contracts' && b.guardrail_id === 'gr-pii')).toBe(true),
    )
    await waitFor(() => expect(conversation().queryByText(/PII redaction is not attached/)).not.toBeInTheDocument())
  })

  it('says when an attached guardrail ran without firing', async () => {
    const user = await open()
    await user.click(scenarios().getByRole('button', { name: /Prompt injection/ }))
    expect(
      await conversation().findByText(
        "A prompt injection got through. Prompt injection detector ran but didn't fire; check its settings.",
      ),
    ).toBeInTheDocument()
  })

  it('points to the library when no guardrail of that kind exists', async () => {
    const user = await open()
    await user.click(scenarios().getByRole('button', { name: /Off-topic/ }))
    expect(
      await conversation().findByText('An off-topic request went through without a warning. The library has no topic guardrail yet.'),
    ).toBeInTheDocument()
    expect(conversation().getByRole('link', { name: 'Create one in the library' })).toHaveAttribute('href', '/guardrails')
  })
})
