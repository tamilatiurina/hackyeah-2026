import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const conversation = () => within(screen.getByRole('list', { name: 'Conversation' }))
const lastReply = () => {
  const replies = conversation().getAllByRole('article')
  return within(replies[replies.length - 1])
}

async function open(path = '/test') {
  const user = userEvent.setup()
  renderApp(path)
  await screen.findByRole('option', { name: 'Support Assistant' })
  return user
}

describe('Test chat', () => {
  it('shows the expected badge for each demo scenario', async () => {
    const user = await open()
    const expected: [string, string][] = [
      ['#pii', 'Redacted'],
      ['#secret', 'Redacted'],
      ['#inject', 'Blocked'],
      ['#toxic', 'Blocked'],
      ['#offtopic', 'Warned'],
    ]
    for (const [chip, badge] of expected) {
      await user.click(screen.getByRole('button', { name: chip }))
      await waitFor(() => expect(lastReply().getByText(badge)).toBeInTheDocument())
    }
    expect(lastReply().getByText("Let's talk about elections and crypto.")).toBeInTheDocument()
  })

  it('sends A2A SendMessage requests within one context, and a new context after New chat', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Message'), 'hello{Enter}')
    await screen.findByText('You said: hello')
    await user.type(screen.getByLabelText('Message'), 'again{Enter}')
    await screen.findByText('You said: again')
    const [first, second] = fakeApi.testChatRequests
    expect(first).toMatchObject({ jsonrpc: '2.0', method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'hello' }] } } })
    expect(second.params.message.contextId).toBe(first.params.message.contextId)
    expect(first.params.message.contextId).toMatch(/^ctx-/)
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    expect(screen.queryByText('You said: hello')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Message'), 'fresh{Enter}')
    await screen.findByText('You said: fresh')
    expect(fakeApi.testChatRequests[2].params.message.contextId).not.toBe(first.params.message.contextId)
  })

  it('starts a new context when the agent changes, ignoring a late reply', async () => {
    server.use(
      http.post(apiPath('/agents/agent-support/test-chat'), async () => {
        await delay(200)
        return HttpResponse.json({ jsonrpc: '2.0', id: 'x', result: { message: { messageId: 'late', role: 'ROLE_AGENT', parts: [{ text: 'late reply' }] } } })
      }),
    )
    const user = await open()
    await user.type(screen.getByLabelText('Message'), 'slow{Enter}')
    await user.selectOptions(screen.getByLabelText('Agent'), 'Contract Summarizer')
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByText('late reply')).not.toBeInTheDocument()
    expect(screen.queryByText('slow')).not.toBeInTheDocument()
  })

  it('sends on Enter, adds a newline on Shift+Enter, never sends blank text', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Message'), '   {Enter}')
    expect(fakeApi.testChatRequests).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Message'))
    await user.type(screen.getByLabelText('Message'), 'line one{Shift>}{Enter}{/Shift}line two')
    expect(screen.getByLabelText('Message')).toHaveValue('line one\nline two')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(fakeApi.testChatRequests[0].params.message.parts).toEqual([{ text: 'line one\nline two' }]))
    expect(screen.getByLabelText('Message')).toHaveValue('')
  })

  it('does not send Enter while an IME composition is active', async () => {
    await open()
    const message = screen.getByLabelText('Message')
    fireEvent.change(message, { target: { value: 'composing' } })
    fireEvent.keyDown(message, { key: 'Enter', isComposing: true })
    expect(fakeApi.testChatRequests).toHaveLength(0)
    expect(message).toHaveValue('composing')
  })

  it('shows agent errors with a Retry that keeps the context', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Message'), '#error{Enter}')
    expect(await screen.findByText('Agent error -32603: Internal error')).toBeInTheDocument()
    expect(lastReply().getByText('Error')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(fakeApi.testChatRequests).toHaveLength(2))
    expect(fakeApi.testChatRequests[1].params.message.contextId).toBe(fakeApi.testChatRequests[0].params.message.contextId)
    expect(fakeApi.testChatRequests[1].params.message.parts).toEqual([{ text: '#error' }])
  })

  it('shows an error when the test chat endpoint is missing, without making up a reply', async () => {
    fakeApi.testChatSupported = false
    const user = await open()
    await user.click(screen.getByRole('button', { name: '#pii' }))
    expect(await lastReply().findByText(/Not Found|404|failed/i)).toBeInTheDocument()
    expect(screen.queryByText('Simulated')).not.toBeInTheDocument()
    expect(lastReply().queryByText('Redacted')).not.toBeInTheDocument()
  })

  it('reveals the trace when a reply is inspected', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: '#pii' }))
    const inspect = await screen.findByRole('button', { name: 'Inspect reply 1' })
    expect(screen.getByRole('button', { name: 'Show trace' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(inspect)
    expect(screen.getByRole('button', { name: 'Hide trace' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('asks to register an agent when there are none', async () => {
    server.use(http.get(apiPath('/agents'), () => HttpResponse.json({ data: [], total: 0 })))
    renderApp('/test')
    expect(await screen.findByText('Register an agent first.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Agents' })).toHaveAttribute('href', '/agents')
  })

  it('announces the reply to screen readers', async () => {
    const user = await open()
    const live = document.querySelector('[data-testid="chat-live"]') as HTMLElement
    expect(live).toHaveAttribute('aria-live', 'polite')
    await user.click(screen.getByRole('button', { name: '#pii' }))
    await waitFor(() => expect(live).toHaveTextContent('Reply 1: Redacted. Reach me at [EMAIL] or [PHONE].'))
    await user.type(screen.getByLabelText('Message'), '#error{Enter}')
    await waitFor(() => expect(live).toHaveTextContent('Reply 2: Error. Agent error -32603: Internal error'))
  })
})
