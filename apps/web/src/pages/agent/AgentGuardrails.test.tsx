import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const section = () => screen.getByRole('region', { name: 'Guardrails' })
const listNames = (name: string) =>
  within(within(section()).getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-name]')?.textContent)
const attachedNames = () => listNames('Attached to this agent')
const heading = () => within(section()).getByRole('heading', { name: 'Attached to this agent' })
const attachedList = () => within(within(section()).getByRole('list', { name: 'Attached to this agent' }))

async function open(id = 'agent-support') {
  const user = userEvent.setup()
  renderApp(`/agents/${id}`)
  await within(await screen.findByRole('region', { name: 'Guardrails' })).findByRole('heading', {
    name: 'Attached to this agent',
  })
  return user
}

describe('Agent guardrails (bindings)', () => {
  it('shows mandatory guardrails as always applied, without controls', async () => {
    await open()
    const always = within(section()).getByRole('list', { name: 'Always applied' })
    expect(within(always).getByText('Prompt injection detector')).toBeInTheDocument()
    expect(within(always).queryByRole('button')).not.toBeInTheDocument()
  })

  it('lists the agent’s bindings in order with their badges', async () => {
    await open()
    expect(attachedNames()).toEqual(['PII redaction'])
    const row = attachedList().getByText('PII redaction').closest('li') as HTMLElement
    expect(within(row).getByText('Open-source library')).toBeInTheDocument()
    expect(within(row).getByText('Redact')).toBeInTheDocument()
  })

  it('offers only enabled, non-mandatory, unbound guardrails', async () => {
    await open()
    const options = within(within(section()).getByLabelText('Attach guardrail'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toEqual(['Choose a guardrail…', 'Toxicity filter'])
  })

  it('attaches at the end and keeps focus on the picker', async () => {
    const user = await open()
    await user.selectOptions(within(section()).getByLabelText('Attach guardrail'), 'Toxicity filter')
    await user.click(within(section()).getByRole('button', { name: 'Attach' }))
    await waitFor(() => expect(attachedNames()).toEqual(['PII redaction', 'Toxicity filter']))
    expect(fakeApi.bindingRequests.at(-1)).toEqual({
      method: 'POST',
      body: { scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-toxicity', order_index: 1, enabled: true },
    })
    expect(within(section()).getByLabelText('Attach guardrail')).toHaveFocus()
    expect(within(section()).getByRole('status')).toHaveTextContent('Attached Toxicity filter')
  })

  it('reorders by renumbering, even when order_index values are equal', async () => {
    fakeApi.bindings = [
      { id: 'rb-a', scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-pii', order_index: 0, enabled: true },
      { id: 'rb-b', scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-toxicity', order_index: 0, enabled: true },
    ]
    const user = await open()
    expect(attachedNames()).toEqual(['PII redaction', 'Toxicity filter'])
    await user.click(within(section()).getByRole('button', { name: 'Move Toxicity filter up' }))
    await waitFor(() => expect(attachedNames()).toEqual(['Toxicity filter', 'PII redaction']))
    // rb-b already sits at 0; only rb-a moves (to 1). Equal values would not have reordered anything.
    expect(fakeApi.bindingRequests).toEqual([{ method: 'PATCH', id: 'rb-a', body: { order_index: 1 } }])
    await waitFor(() =>
      expect(within(section()).getByRole('button', { name: 'Move Toxicity filter down' })).toHaveFocus(),
    )
  })

  it('pauses and resumes a binding', async () => {
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Pause PII redaction' }))
    const row = (await within(section()).findByText('Paused')).closest('li') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Resume PII redaction' })).toBeInTheDocument()
    expect(fakeApi.bindingRequests.at(-1)).toEqual({ method: 'PATCH', id: 'rb-1', body: { enabled: false } })
    await waitFor(() =>
      expect(within(within(section()).getByRole('list', { name: 'Output checks' })).queryByText('PII redaction')).toBeNull(),
    )
  })

  it('removes a binding and returns focus to the heading', async () => {
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    expect(
      await within(section()).findByText('No guardrails attached. Only the mandatory ones run.'),
    ).toBeInTheDocument()
    expect(fakeApi.bindingRequests.at(-1)).toEqual({ method: 'DELETE', id: 'rb-1' })
    await waitFor(() => expect(heading()).toHaveFocus())
  })

  it('shows the API’s message when attaching fails', async () => {
    server.use(
      http.post(apiPath('/bindings'), () =>
        HttpResponse.json({ detail: 'This guardrail is already attached to that scope' }, { status: 409 }),
      ),
    )
    const user = await open()
    await user.selectOptions(within(section()).getByLabelText('Attach guardrail'), 'Toxicity filter')
    await user.click(within(section()).getByRole('button', { name: 'Attach' }))
    expect(await within(section()).findByText('This guardrail is already attached to that scope')).toBeInTheDocument()
  })

  it('shows unknown guardrail ids so they can be removed', async () => {
    fakeApi.bindings = [
      { id: 'rb-x', scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-gone', order_index: 0, enabled: true },
    ]
    renderApp('/agents/agent-support')
    expect(await screen.findByText('Unknown guardrail (gr-gone)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Unknown guardrail (gr-gone)' })).toBeInTheDocument()
  })

  it('shows what runs on input and output, with each source', async () => {
    await open()
    await waitFor(() => expect(listNames('Input checks')).toEqual(['Prompt injection detector']))
    expect(listNames('Output checks')).toEqual(['PII redaction'])
    const input = within(within(section()).getByRole('list', { name: 'Input checks' }))
    expect(input.getByText('Mandatory')).toBeInTheDocument()
    const output = within(within(section()).getByRole('list', { name: 'Output checks' }))
    expect(output.getByText('Agent')).toBeInTheDocument()
  })

  it('falls back when the API has no bindings endpoint', async () => {
    fakeApi.bindingsSupported = false
    renderApp('/agents/agent-support')
    expect(await screen.findByText("Attaching guardrails isn't available on this API yet.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Attach guardrail')).not.toBeInTheDocument()
    expect(within(section()).getByRole('list', { name: 'Always applied' })).toBeInTheDocument()
  })
})
