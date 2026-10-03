import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const panel = () => within(screen.getByRole('region', { name: 'Trace' }))

async function open() {
  const user = userEvent.setup()
  renderApp('/test')
  await screen.findByRole('option', { name: 'Support Assistant' })
  return user
}

describe('Trace panel', () => {
  it('starts with a hint', async () => {
    await open()
    expect(panel().getByText('Send a message to see what the guardrails did.')).toBeInTheDocument()
  })

  it('shows the latest reply’s guardrail runs, usage and limits', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: '#offtopic' }))
    const row = (await panel().findByText('Topic: orders and returns only')).closest('tr') as HTMLElement
    expect(within(row).getByText('Output')).toBeInTheDocument()
    expect(within(row).getByText('Warn')).toBeInTheDocument()
    expect(within(row).getByText('Simulated: Mentions a denied topic: crypto')).toBeInTheDocument()
    expect(within(row).getByText('3 ms')).toBeInTheDocument()
    expect(within(row).getByText('Simulated')).toBeInTheDocument()
    expect(panel().getByText('1 in · 12 out')).toBeInTheDocument() // '#offtopic' is one word
    expect(panel().getByText('$0.0002')).toBeInTheDocument()
    expect(panel().getByText('Session tokens: 24 / 16000')).toBeInTheDocument()
  })

  it('follows the selected reply', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: '#pii' }))
    await panel().findByText('PII redaction')
    await user.click(screen.getByRole('button', { name: '#inject' }))
    await waitFor(() => expect(panel().queryByText('PII redaction')).not.toBeInTheDocument())
    expect(panel().getByText('Matched injection signature: ignore-instructions')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Inspect reply 1' }))
    expect(panel().getByText('PII redaction')).toBeInTheDocument()
  })

  it('says when no guardrails ran', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Message'), '#error{Enter}')
    expect(await panel().findByText('No guardrails ran for this reply.')).toBeInTheDocument()
  })
})

describe('Flag reply', () => {
  it('sends the flag with the context and message ids', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: '#pii' }))
    await screen.findByText('Reach me at [EMAIL] or [PHONE].')
    await user.click(screen.getByRole('button', { name: 'Flag reply 1' }))
    await user.type(screen.getByLabelText('Comment'), 'Phone should be kept')
    await user.click(screen.getByRole('button', { name: 'Send flag' }))
    expect(await screen.findByText('Flagged')).toBeInTheDocument()
    const sent = fakeApi.testChatRequests[0].params.message.contextId
    expect(fakeApi.flags).toEqual([{ contextId: sent, messageId: 'agent-1', comment: 'Phone should be kept' }])
  })

  it('explains when flagging is not available yet', async () => {
    fakeApi.flagsSupported = false
    const user = await open()
    await user.click(screen.getByRole('button', { name: '#pii' }))
    await screen.findByText('Reach me at [EMAIL] or [PHONE].')
    await user.click(screen.getByRole('button', { name: 'Flag reply 1' }))
    await user.type(screen.getByLabelText('Comment'), 'x')
    await user.click(screen.getByRole('button', { name: 'Send flag' }))
    expect(await screen.findByText("Flagging isn't available on this API yet.")).toBeInTheDocument()
  })
})
