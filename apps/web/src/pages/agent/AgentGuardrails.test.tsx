import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const main = () => screen.getByRole('main')
const attachedSection = () => screen.getByRole('region', { name: 'Guardrails on Support Assistant' })
const library = () => screen.getByRole('region', { name: 'Add from the library' })
const order = () => screen.getByRole('region', { name: 'Runs in this order' })
const listNames = (name: string) =>
  within(within(main()).getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-name]')?.textContent)
const attachedNames = () => listNames('Attached to this agent')
const heading = () => within(attachedSection()).getByRole('heading', { name: 'Attached to this agent' })
const attachedList = () => within(within(attachedSection()).getByRole('list', { name: 'Attached to this agent' }))
const toast = () => screen.getAllByRole('status').find((el) => el.textContent)

async function open(id = 'agent-support') {
  const user = userEvent.setup()
  renderApp(`/agents/${id}/guardrails`)
  await within(await screen.findByRole('region', { name: /^Guardrails on/ })).findByRole('heading', {
    name: 'Attached to this agent',
  })
  return user
}

describe('Agent guardrails step (bindings)', () => {
  it('shows mandatory guardrails as always applied, without controls', async () => {
    await open()
    const always = within(attachedSection()).getByRole('list', { name: 'Always applied' })
    expect(within(always).getByText('Prompt injection detector')).toBeInTheDocument()
    expect(within(always).getByText('Mandatory on all your agents')).toBeInTheDocument()
    expect(within(always).queryByRole('button')).not.toBeInTheDocument()
  })

  it('lists the agent’s bindings in order with their badges', async () => {
    await open()
    expect(attachedNames()).toEqual(['PII redaction'])
    const row = attachedList().getByText('PII redaction').closest('li') as HTMLElement
    expect(within(row).getByText('Open-source library')).toBeInTheDocument()
    expect(within(row).getByText('Redact')).toBeInTheDocument()
    expect(within(attachedSection()).getByText('1 mandatory · 1 attached')).toBeInTheDocument()
  })

  it('offers only enabled, non-mandatory, unbound guardrails from the library', async () => {
    await open()
    const cards = within(library()).getAllByRole('listitem')
    expect(cards.map((c) => within(c).getByRole('button').getAttribute('aria-label'))).toEqual(['Attach Toxicity filter'])
    expect(within(library()).getByRole('link', { name: 'Create a new guardrail' })).toHaveAttribute('href', '/guardrails')
  })

  it('attaches at the end and moves focus to the attached list', async () => {
    const user = await open()
    await user.click(within(library()).getByRole('button', { name: 'Attach Toxicity filter' }))
    await waitFor(() => expect(attachedNames()).toEqual(['PII redaction', 'Toxicity filter']))
    expect(fakeApi.bindingRequests.at(-1)).toEqual({
      method: 'POST',
      body: { scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-toxicity', order_index: 1, enabled: true },
    })
    await waitFor(() => expect(heading()).toHaveFocus())
    expect(toast()).toHaveTextContent('Attached Toxicity filter.')
    expect(within(library()).getByText('Every guardrail in the library is attached.')).toBeInTheDocument()
  })

  it('reorders by renumbering, even when order_index values are equal', async () => {
    fakeApi.bindings = [
      { id: 'rb-a', scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-pii', order_index: 0, enabled: true },
      { id: 'rb-b', scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-toxicity', order_index: 0, enabled: true },
    ]
    const user = await open()
    expect(attachedNames()).toEqual(['PII redaction', 'Toxicity filter'])
    await user.click(within(attachedSection()).getByRole('button', { name: 'Move Toxicity filter up' }))
    await waitFor(() => expect(attachedNames()).toEqual(['Toxicity filter', 'PII redaction']))
    // rb-b already sits at 0; only rb-a moves (to 1). Equal values would not have reordered anything.
    expect(fakeApi.bindingRequests).toEqual([{ method: 'PATCH', id: 'rb-a', body: { order_index: 1 } }])
    await waitFor(() =>
      expect(within(attachedSection()).getByRole('button', { name: 'Move Toxicity filter down' })).toHaveFocus(),
    )
  })

  it('pauses and resumes a binding', async () => {
    const user = await open()
    await user.click(within(attachedSection()).getByRole('button', { name: 'Pause PII redaction' }))
    const row = (await within(attachedSection()).findByText('Paused')).closest('li') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Resume PII redaction' })).toBeInTheDocument()
    expect(fakeApi.bindingRequests.at(-1)).toEqual({ method: 'PATCH', id: 'rb-1', body: { enabled: false } })
    await waitFor(() =>
      expect(within(within(order()).getByRole('list', { name: 'Output checks' })).queryByText('PII redaction')).toBeNull(),
    )
  })

  it('removes a binding and returns focus to the heading', async () => {
    const user = await open()
    await user.click(within(attachedSection()).getByRole('button', { name: 'Remove PII redaction' }))
    expect(await within(attachedSection()).findByText(/No guardrails attached\. Only the mandatory ones run\./)).toBeInTheDocument()
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
    await user.click(within(library()).getByRole('button', { name: 'Attach Toxicity filter' }))
    expect(await within(attachedSection()).findByText('This guardrail is already attached to that scope')).toBeInTheDocument()
  })

  it('shows unknown guardrail ids so they can be removed', async () => {
    fakeApi.bindings = [
      { id: 'rb-x', scope_type: 'agent', scope_id: 'agent-support', guardrail_id: 'gr-gone', order_index: 0, enabled: true },
    ]
    renderApp('/agents/agent-support/guardrails')
    expect(await screen.findByText('Unknown guardrail (gr-gone)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Unknown guardrail (gr-gone)' })).toBeInTheDocument()
  })

  it('shows what runs on input and output, with each source', async () => {
    await open()
    await waitFor(() => expect(within(order()).getAllByRole('list')).toHaveLength(2))
    const input = within(within(order()).getByRole('list', { name: 'Input checks' }))
    expect(input.getByText('Prompt injection detector')).toBeInTheDocument()
    expect(input.getByText('Mandatory')).toBeInTheDocument()
    const output = within(within(order()).getByRole('list', { name: 'Output checks' }))
    expect(output.getByText('PII redaction')).toBeInTheDocument()
    expect(output.getByText('Agent')).toBeInTheDocument()
  })

  it('draws the order as a flow: caller, input checks, the agent, output checks, reply', async () => {
    await open()
    const flow = await within(order()).findByRole('group', { name: 'Guardrail order' })
    await waitFor(() => expect(within(flow).getByText('Prompt injection detector')).toBeInTheDocument())
    const text = flow.textContent ?? ''
    const steps = ['Caller', 'Prompt injection detector', 'Support Assistant', 'PII redaction', 'Reply']
    const positions = steps.map((step) => text.indexOf(step))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    const output = within(within(flow).getByRole('list', { name: 'Output checks' }))
    expect(output.getByText('1')).toBeInTheDocument()
    expect(output.getByText('Redact')).toBeInTheDocument()
  })

  it('says when the library has nothing to attach', async () => {
    fakeApi.guardrails = fakeApi.guardrails.filter((g) => g.is_mandatory)
    await open()
    expect(
      within(library()).getByText('The library has no guardrails to attach yet. Create one, then attach it here.'),
    ).toBeInTheDocument()
  })

  it('falls back when the API has no bindings endpoint', async () => {
    fakeApi.bindingsSupported = false
    renderApp('/agents/agent-support/guardrails')
    expect(await screen.findByText("Attaching guardrails isn't available on this API yet.")).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Add from the library' })).not.toBeInTheDocument()
    expect(within(attachedSection()).getByRole('list', { name: 'Always applied' })).toBeInTheDocument()
  })

  it('shows and retries an effective guardrails error', async () => {
    server.use(
      http.get(apiPath('/effective-guardrails'), () => HttpResponse.json({ detail: 'Policy unavailable' }, { status: 503 }), {
        once: true,
      }),
    )
    const user = await open()
    expect(await within(order()).findByText("Couldn't load effective guardrails.")).toBeInTheDocument()
    await user.click(within(order()).getByRole('button', { name: 'Retry' }))
    expect(await within(order()).findByRole('group', { name: 'Guardrail order' })).toBeInTheDocument()
  })

  it('marks the step done and moves on from the next-step bar', async () => {
    fakeApi.bindings = []
    const user = await open()
    const bar = screen.getByRole('region', { name: 'Next step' })
    expect(within(bar).getByText('Nothing attached yet. Only the mandatory guardrails will run.')).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Continue to MCP tools' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/agents/agent-support/mcp'))
    expect(fakeApi.setupSteps).toEqual([{ agentId: 'agent-support', step: 'guardrails' }])
    expect(fakeApi.agents[0].guardrails_reviewed).toBe(true)
  })
})
