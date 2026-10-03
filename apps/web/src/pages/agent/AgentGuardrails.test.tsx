import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const section = () => screen.getByRole('region', { name: 'Guardrails' })
const attachedNames = () =>
  within(within(section()).getByRole('list', { name: 'Attached guardrails' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-name]')?.textContent)

async function open(id = 'agent-support') {
  const user = userEvent.setup()
  renderApp(`/agents/${id}`)
  await within(await screen.findByRole('region', { name: 'Guardrails' })).findByText('PII redaction')
  return user
}

describe('Agent guardrails', () => {
  it('shows mandatory guardrails as always applied, without controls', async () => {
    await open()
    const always = within(section()).getByRole('list', { name: 'Always applied' })
    expect(within(always).getByText('Prompt injection detector')).toBeInTheDocument()
    expect(within(always).queryByRole('button')).not.toBeInTheDocument()
  })

  it('lists attached guardrails in order with their badges', async () => {
    await open()
    expect(attachedNames()).toEqual(['PII redaction'])
    const row = within(section()).getByText('PII redaction').closest('li') as HTMLElement
    expect(within(row).getByText('Open-source library')).toBeInTheDocument()
    expect(within(row).getByText('Redact')).toBeInTheDocument()
  })

  it('never offers mandatory or attached guardrails for attaching', async () => {
    await open()
    const options = within(within(section()).getByLabelText('Attach guardrail'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toEqual(['Choose a guardrail…', 'Toxicity filter'])
  })

  it('attaches, reorders and saves in order', async () => {
    const user = await open()
    await user.selectOptions(within(section()).getByLabelText('Attach guardrail'), 'Toxicity filter')
    await user.click(within(section()).getByRole('button', { name: 'Attach' }))
    expect(attachedNames()).toEqual(['PII redaction', 'Toxicity filter'])
    expect(within(section()).getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(within(section()).getByRole('button', { name: 'Move Toxicity filter up' }))
    expect(attachedNames()).toEqual(['Toxicity filter', 'PII redaction'])
    await user.click(within(section()).getByRole('button', { name: 'Save guardrails' }))
    await within(section()).findByRole('button', { name: 'Move Toxicity filter down' })
    expect(within(section()).queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toEqual({
      attached_rules: [
        { rule_id: 'gr-toxicity', rule_type: 'guardrail' },
        { rule_id: 'gr-pii', rule_type: 'guardrail' },
      ],
    })
  })

  it('keeps policy rules when saving', async () => {
    fakeApi.agents[0] = {
      ...fakeApi.agents[0],
      attached_rules: [
        { rule_id: 'pol-1', rule_type: 'policy', order_index: 0 },
        { rule_id: 'gr-pii', rule_type: 'guardrail', order_index: 1 },
      ],
    }
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    await user.click(within(section()).getByRole('button', { name: 'Save guardrails' }))
    await within(section()).findByText('No guardrails attached. Only the mandatory ones run.')
    expect(fakeApi.lastAgentUpdate).toEqual({ attached_rules: [{ rule_id: 'pol-1', rule_type: 'policy' }] })
  })

  it('discards local changes', async () => {
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    expect(within(section()).getByText('No guardrails attached. Only the mandatory ones run.')).toBeInTheDocument()
    await user.click(within(section()).getByRole('button', { name: 'Discard' }))
    expect(attachedNames()).toEqual(['PII redaction'])
    expect(fakeApi.lastAgentUpdate).toBeNull()
  })

  it('disables moving past the ends', async () => {
    await open()
    expect(within(section()).getByRole('button', { name: 'Move PII redaction up' })).toBeDisabled()
    expect(within(section()).getByRole('button', { name: 'Move PII redaction down' })).toBeDisabled()
  })

  it('shows unknown guardrail ids so they can be removed', async () => {
    fakeApi.agents[0] = {
      ...fakeApi.agents[0],
      attached_rules: [{ rule_id: 'gr-gone', rule_type: 'guardrail', order_index: 0 }],
    }
    renderApp('/agents/agent-support')
    expect(await screen.findByText('Unknown guardrail (gr-gone)')).toBeInTheDocument()
  })

  it('says attaching is not available when the API has no attached_rules', async () => {
    fakeApi.agentsSupport.attachments = false
    renderApp('/agents/agent-support')
    expect(await screen.findByText("Attaching guardrails isn't available on this API yet.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Attach guardrail')).not.toBeInTheDocument()
    expect(within(section()).getByRole('list', { name: 'Always applied' })).toBeInTheDocument()
  })

  it('says attaching is not available when saving returns 405', async () => {
    fakeApi.agentsSupport.update = false
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    await user.click(within(section()).getByRole('button', { name: 'Save guardrails' }))
    expect(await within(section()).findByText("Attaching guardrails isn't available on this API yet.")).toBeInTheDocument()
  })

  it('never lists or re-sends a mandatory guardrail found in attached_rules', async () => {
    fakeApi.agents[0] = {
      ...fakeApi.agents[0],
      attached_rules: [
        { rule_id: 'gr-injection', rule_type: 'guardrail', order_index: 0 },
        { rule_id: 'gr-pii', rule_type: 'guardrail', order_index: 1 },
      ],
    }
    const user = await open()
    expect(attachedNames()).toEqual(['PII redaction'])
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    await user.click(within(section()).getByRole('button', { name: 'Save guardrails' }))
    await within(section()).findByText('No guardrails attached. Only the mandatory ones run.')
    expect(fakeApi.lastAgentUpdate).toEqual({ attached_rules: [] })
  })

  it('keeps keyboard focus in the section after each action', async () => {
    const user = await open()
    const heading = () => within(section()).getByRole('heading', { name: 'Attached guardrails' })
    await user.selectOptions(within(section()).getByLabelText('Attach guardrail'), 'Toxicity filter')
    await user.click(within(section()).getByRole('button', { name: 'Attach' }))
    expect(within(section()).getByLabelText('Attach guardrail')).toHaveFocus()
    await user.click(within(section()).getByRole('button', { name: 'Move Toxicity filter up' }))
    await waitFor(() => expect(within(section()).getByRole('button', { name: 'Move Toxicity filter down' })).toHaveFocus())
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    await waitFor(() => expect(heading()).toHaveFocus())
    await user.click(within(section()).getByRole('button', { name: 'Save guardrails' }))
    expect(await within(section()).findByText('Guardrails saved')).toBeInTheDocument()
    await waitFor(() => expect(heading()).toHaveFocus())
  })

  it('returns focus to the list heading after Discard', async () => {
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    await user.click(within(section()).getByRole('button', { name: 'Discard' }))
    await waitFor(() =>
      expect(within(section()).getByRole('heading', { name: 'Attached guardrails' })).toHaveFocus(),
    )
  })
})
