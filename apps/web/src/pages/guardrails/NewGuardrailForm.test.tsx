import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

async function openForm() {
  const user = userEvent.setup()
  renderApp('/guardrails')
  await user.click(await screen.findByRole('button', { name: 'New guardrail' }))
  return user
}

const templateChips = () =>
  within(screen.getByRole('group', { name: 'Template' }))
    .getAllByRole('button')
    .map((b) => b.textContent)
const actionOptions = () =>
  within(screen.getByLabelText('Action'))
    .getAllByRole('option')
    .map((o) => o.textContent)
const engine = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) })

describe('New guardrail', () => {
  it('needs an engine before saving', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'No pins')
    await user.click(screen.getByRole('button', { name: 'Save guardrail' }))
    expect(screen.getByText('Pick an engine first.')).toBeInTheDocument()
    expect(fakeApi.guardrails).toHaveLength(3)
  })

  it('moves focus to the first engine when it opens', async () => {
    await openForm()
    expect(engine('Regex \\+ rules')).toHaveFocus()
  })

  it('offers only templates the engine can run', async () => {
    const user = await openForm()
    expect(within(screen.getByRole('group', { name: 'Template' })).getByRole('button', { name: 'None' })).toBeDisabled()
    await user.click(engine('Moderation API'))
    expect(templateChips()).toEqual(['None', 'Toxicity'])
    await user.click(engine('Regex \\+ rules'))
    expect(templateChips()).toEqual(['None', 'Prompt injection', 'Regex'])
  })

  it('offers only actions the template allows', async () => {
    const user = await openForm()
    await user.click(engine('Regex \\+ rules'))
    expect(actionOptions()).toEqual(['Block', 'Redact', 'Warn'])
    await user.click(screen.getByRole('button', { name: 'Prompt injection' }))
    expect(actionOptions()).toEqual(['Block', 'Warn'])
    expect(screen.getByText('Uses the company injection signatures below.')).toBeInTheDocument()
  })

  it('resets an incompatible template and action when the engine changes', async () => {
    const user = await openForm()
    await user.click(engine('Open-source library'))
    await user.click(screen.getByRole('button', { name: 'PII' }))
    await user.selectOptions(screen.getByLabelText('Action'), 'Redact')
    await user.click(engine('Moderation API'))
    expect(screen.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Action')).toHaveValue('block')
    expect(screen.getByLabelText('Threshold')).toBeInTheDocument()
  })

  it('shows the fields of the chosen template', async () => {
    const user = await openForm()
    await user.click(engine('LLM judge'))
    expect(screen.getByLabelText('Judge prompt')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Topic allow/deny list' }))
    expect(screen.getByLabelText('Topics (comma-separated)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Judge prompt')).not.toBeInTheDocument()
  })

  it('dry-runs a redacting regex', async () => {
    const user = await openForm()
    await user.click(engine('Regex \\+ rules'))
    await user.type(screen.getByLabelText('Pattern'), '\\d{{4}')
    await user.clear(screen.getByLabelText('Replacement'))
    await user.type(screen.getByLabelText('Replacement'), '####')
    await user.selectOptions(screen.getByLabelText('Action'), 'Redact')
    await user.type(screen.getByLabelText('Try it on sample text'), 'pin 1234')
    await user.click(screen.getByRole('button', { name: 'Dry run' }))
    const result = await screen.findByTestId('dry-run-result')
    expect(within(result).getByText('Redact')).toBeInTheDocument()
    expect(within(result).getByText('Matched /\\d{4}/')).toBeInTheDocument()
    expect(within(result).getByText('pin ####')).toBeInTheDocument()
    expect(within(result).queryByText('Simulated')).not.toBeInTheDocument()
  })

  it('marks simulated verdicts', async () => {
    const user = await openForm()
    await user.click(engine('Moderation API'))
    await user.type(screen.getByLabelText('Try it on sample text'), 'you idiot')
    await user.click(screen.getByRole('button', { name: 'Dry run' }))
    const result = await screen.findByTestId('dry-run-result')
    expect(within(result).getByText('Block')).toBeInTheDocument()
    expect(within(result).getByText('Simulated')).toBeInTheDocument()
  })

  it('shows the server message when saving fails', async () => {
    server.use(
      http.post(apiPath('/guardrails'), () =>
        HttpResponse.json(
          { detail: [{ type: 'value_error', loc: ['body'], msg: 'Value error, name already used', input: {} }] },
          { status: 422 },
        ),
      ),
    )
    const user = await openForm()
    await user.click(engine('Moderation API'))
    await user.type(screen.getByLabelText('Name'), 'Tox')
    await user.click(screen.getByRole('button', { name: 'Save guardrail' }))
    expect(await screen.findByText('name already used')).toBeInTheDocument()
  })

  it('saves, closes, highlights the card and returns focus', async () => {
    const user = await openForm()
    await user.click(engine('Regex \\+ rules'))
    await user.type(screen.getByLabelText('Name'), 'No pins')
    await user.type(screen.getByLabelText('Pattern'), '\\d{{4}')
    await user.click(screen.getByRole('button', { name: 'Save guardrail' }))
    const card = await screen.findByRole('article', { name: 'No pins' })
    expect(card).toHaveAttribute('data-highlight', 'true')
    await waitFor(() => expect(screen.getByRole('button', { name: 'New guardrail' })).toHaveFocus())
    expect(fakeApi.guardrails.at(-1)).toMatchObject({
      name: 'No pins',
      engine: 'regex',
      stages: ['input'],
      action: 'block',
      config: { template: 'regex', pattern: '\\d{4}', replacement: '[REDACTED]' },
      description: null,
    })
  })

  it('checks template fields before saving', async () => {
    const user = await openForm()
    await user.click(engine('LLM judge'))
    await user.type(screen.getByLabelText('Name'), 'Judge')
    await user.type(screen.getByLabelText('Judge prompt'), 'too short')
    await user.click(screen.getByRole('button', { name: 'Save guardrail' }))
    expect(screen.getByText('Write a prompt of at least 10 characters')).toBeInTheDocument()
    expect(fakeApi.guardrails).toHaveLength(3)
  })
})
