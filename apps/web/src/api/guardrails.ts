import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRole } from '../app/role'
import { deleteJson, getJson, patchJson, postJson } from './client'
import type {
  DryRunRequest,
  DryRunResult,
  Guardrail,
  GuardrailCreate,
  GuardrailTemplate,
  GuardrailUpdate,
  InjectionSignature,
} from './types'

export const guardrailKeys = {
  templates: ['guardrail-templates'] as const,
  guardrails: ['guardrails'] as const,
  signatures: ['injection-signatures'] as const,
}

const enc = encodeURIComponent

export function useGuardrailTemplates() {
  return useQuery({
    queryKey: guardrailKeys.templates,
    queryFn: () => getJson<GuardrailTemplate[]>('/guardrail-templates'),
    staleTime: Infinity,
  })
}

export function useGuardrails() {
  return useQuery({ queryKey: guardrailKeys.guardrails, queryFn: () => getJson<Guardrail[]>('/guardrails') })
}

export function useCreateGuardrail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: GuardrailCreate) => postJson<Guardrail>('/guardrails', body),
    onSuccess: (created) => {
      queryClient.setQueryData<Guardrail[]>(guardrailKeys.guardrails, (old) => [...(old ?? []), created])
      void queryClient.invalidateQueries({ queryKey: guardrailKeys.guardrails })
    },
  })
}

export function useUpdateGuardrail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: GuardrailUpdate }) =>
      patchJson<Guardrail>(`/guardrails/${enc(id)}`, changes),
    onSuccess: (updated) => {
      queryClient.setQueryData<Guardrail[]>(guardrailKeys.guardrails, (old) =>
        (old ?? []).map((g) => (g.id === updated.id ? updated : g)),
      )
      void queryClient.invalidateQueries({ queryKey: guardrailKeys.guardrails })
    },
  })
}

export function useDeleteGuardrail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/guardrails/${enc(id)}`),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Guardrail[]>(guardrailKeys.guardrails, (old) => (old ?? []).filter((g) => g.id !== id))
      void queryClient.invalidateQueries({ queryKey: guardrailKeys.guardrails })
    },
  })
}

export function dryRunGuardrail(body: DryRunRequest): Promise<DryRunResult> {
  return postJson<DryRunResult>('/guardrails/dry-run', body)
}

export function useSignatures() {
  return useQuery({
    queryKey: guardrailKeys.signatures,
    queryFn: () => getJson<InjectionSignature[]>('/injection-signatures'),
  })
}

export function useAddSignature() {
  const queryClient = useQueryClient()
  const { role } = useRole()
  return useMutation({
    mutationFn: (signature: InjectionSignature) =>
      postJson<InjectionSignature>('/injection-signatures', signature, { 'X-Role': role }),
    onSuccess: (added) => {
      queryClient.setQueryData<InjectionSignature[]>(guardrailKeys.signatures, (old) => [...(old ?? []), added])
      void queryClient.invalidateQueries({ queryKey: guardrailKeys.signatures })
    },
  })
}

export function useDeleteSignature() {
  const queryClient = useQueryClient()
  const { role } = useRole()
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/injection-signatures/${enc(id)}`, { 'X-Role': role }),
    onSuccess: (_, id) => {
      queryClient.setQueryData<InjectionSignature[]>(guardrailKeys.signatures, (old) =>
        (old ?? []).filter((s) => s.id !== id),
      )
      void queryClient.invalidateQueries({ queryKey: guardrailKeys.signatures })
    },
  })
}
