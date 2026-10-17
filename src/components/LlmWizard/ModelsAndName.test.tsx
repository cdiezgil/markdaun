import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';
import { ModelsAndName } from './ModelsAndName';
import { PRESETS, draftFromPreset } from '../../lib/llm/presets';

const mockInvoke = vi.mocked(invoke);

const draft = { ...draftFromPreset(PRESETS.find((p) => p.id === 'anthropic-api')!), models: ['claude-sonnet-4-5'] };
const RESULT = {
  token: 'tok',
  available: ['claude-sonnet-4-5', 'claude-opus-4-1'],
  verified: ['claude-sonnet-4-5', 'claude-opus-4-1'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

function renderStep(over: Partial<React.ComponentProps<typeof ModelsAndName>> = {}) {
  const onSaved = vi.fn();
  const onBack = vi.fn();
  render(
    <ModelsAndName
      draft={draft}
      result={RESULT}
      secret="sk"
      suggested={['claude-haiku-4-5']}
      onSaved={onSaved}
      onBack={onBack}
      {...over}
    />,
  );
  return { onSaved, onBack };
}

describe('ModelsAndName', () => {
  it('lists listed + suggested models, pre-selects the tested one and prefills the name', () => {
    renderStep();
    expect(screen.getByTestId('model-claude-sonnet-4-5')).toBeChecked();
    expect(screen.getByTestId('model-claude-opus-4-1')).not.toBeChecked();
    expect(screen.getByTestId('model-claude-haiku-4-5')).not.toBeChecked();
    expect(screen.getByTestId('connection-name')).toHaveValue('Anthropic API');
  });

  it('saves with the selected models, the secret and the validation token', async () => {
    const saved = { ...draft, id: 'new' };
    mockInvoke.mockResolvedValueOnce(saved as never);
    const { onSaved } = renderStep();

    fireEvent.click(screen.getByTestId('model-claude-opus-4-1')); // verified (listed)
    fireEvent.change(screen.getByTestId('connection-name'), { target: { value: '  Casa  ' } });
    fireEvent.click(screen.getByTestId('save-btn'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(mockInvoke).toHaveBeenCalledWith('llm_save_connection', {
      draft: {
        ...draft,
        name: 'Casa',
        models: ['claude-sonnet-4-5', 'claude-opus-4-1'],
        visionModels: ['claude-sonnet-4-5', 'claude-opus-4-1'],
      },
      secret: 'sk',
      validationToken: 'tok',
    });
  });

  it('save is disabled without a name or without any selected model', () => {
    renderStep();
    fireEvent.change(screen.getByTestId('connection-name'), { target: { value: ' ' } });
    expect(screen.getByTestId('save-btn')).toBeDisabled();
    fireEvent.change(screen.getByTestId('connection-name'), { target: { value: 'X' } });
    expect(screen.getByTestId('save-btn')).toBeEnabled();
    fireEvent.click(screen.getByTestId('model-claude-sonnet-4-5')); // unselect the only one
    expect(screen.getByTestId('save-btn')).toBeDisabled();
  });

  it('an unverified model is test-completed before it can be selected', async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);
    renderStep();
    fireEvent.click(screen.getByTestId('model-claude-haiku-4-5'));
    await waitFor(() => expect(screen.getByTestId('model-claude-haiku-4-5')).toBeChecked());
    expect(mockInvoke).toHaveBeenCalledWith('llm_verify_model', {
      draft,
      secret: 'sk',
      token: 'tok',
      model: 'claude-haiku-4-5',
    });
  });

  it('a model that fails verification stays unselected and shows why', async () => {
    mockInvoke.mockRejectedValueOnce({ kind: 'ModelNotFound' });
    renderStep();
    fireEvent.click(screen.getByTestId('model-claude-haiku-4-5'));
    expect(await screen.findByTestId('models-error')).toHaveTextContent(/modelo no existe/i);
    expect(screen.getByTestId('model-claude-haiku-4-5')).not.toBeChecked();
  });

  it('custom models (e.g. Azure deployments) can be added and are verified', async () => {
    mockInvoke.mockResolvedValueOnce(undefined as never);
    renderStep({ result: { token: 'tok', available: [], verified: ['claude-sonnet-4-5'] }, suggested: [] });
    fireEvent.change(screen.getByTestId('custom-model-input'), { target: { value: 'my-deployment' } });
    fireEvent.click(screen.getByTestId('add-model'));
    await waitFor(() => expect(screen.getByTestId('model-my-deployment')).toBeChecked());
    expect(mockInvoke).toHaveBeenCalledWith(
      'llm_verify_model',
      expect.objectContaining({ model: 'my-deployment' }),
    );
  });

  it('shows a typed save error and stays on the step', async () => {
    mockInvoke.mockRejectedValueOnce({ kind: 'NotValidated' });
    const { onSaved } = renderStep();
    fireEvent.click(screen.getByTestId('save-btn'));
    expect(await screen.findByTestId('models-error')).toHaveTextContent(/no está validada/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('sends a null secret when none was typed (editing)', async () => {
    mockInvoke.mockResolvedValueOnce({ ...draft, id: 'abc' } as never);
    renderStep({ secret: '' });
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('llm_save_connection', expect.objectContaining({ secret: null })),
    );
  });
});


describe('ModelsAndName vision', () => {
  const kimiDraft = {
    ...draftFromPreset(PRESETS.find((p) => p.id === 'kimi-coding')!),
    models: ['kimi-for-coding'],
  };
  const kimiResult = { token: 'tok', available: [], verified: ['kimi-for-coding'] };

  it('flags text-only models by default and warns about it', () => {
    renderStep({ draft: kimiDraft, result: kimiResult, suggested: ['kimi-for-coding'] });
    expect(screen.getByTestId('vision-kimi-for-coding')).toHaveTextContent('Solo texto');
    expect(screen.getByTestId('vision-warning')).toHaveTextContent('no verá imágenes');
  });

  it('known vision families are flagged as seeing images without a warning', () => {
    renderStep();
    expect(screen.getByTestId('vision-claude-sonnet-4-5')).toHaveTextContent('Ve imágenes');
    expect(screen.queryByTestId('vision-warning')).not.toBeInTheDocument();
  });

  it('«Probar visión» records the probe result and it is saved', async () => {
    mockInvoke.mockResolvedValueOnce(true as never); // llm_test_vision
    const saved = { ...kimiDraft, id: 'n' };
    renderStep({ draft: kimiDraft, result: kimiResult, suggested: ['kimi-for-coding'] });
    fireEvent.click(screen.getByTestId('test-vision-kimi-for-coding'));
    await waitFor(() => expect(screen.getByTestId('vision-kimi-for-coding')).toHaveTextContent('Ve imágenes'));
    expect(mockInvoke).toHaveBeenCalledWith('llm_test_vision', {
      draft: kimiDraft,
      secret: 'sk',
      model: 'kimi-for-coding',
    });
    expect(screen.queryByTestId('vision-warning')).not.toBeInTheDocument();

    mockInvoke.mockResolvedValueOnce(saved as never);
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        'llm_save_connection',
        expect.objectContaining({
          draft: expect.objectContaining({ visionModels: ['kimi-for-coding'] }),
        }),
      ),
    );
  });

  it('editing keeps the stored flag of models the connection already had', () => {
    renderStep({ draft: { ...draft, id: 'saved', visionModels: [] } });
    expect(screen.getByTestId('vision-claude-sonnet-4-5')).toHaveTextContent('Solo texto');
  });

  it('a negative probe marks the model as text-only', async () => {
    mockInvoke.mockResolvedValueOnce(false as never);
    renderStep();
    fireEvent.click(screen.getByTestId('test-vision-claude-sonnet-4-5'));
    await waitFor(() => expect(screen.getByTestId('vision-claude-sonnet-4-5')).toHaveTextContent('Solo texto'));
    expect(screen.getByTestId('vision-warning')).toBeInTheDocument();
  });

  it('a failing probe shows the error and keeps the previous flag', async () => {
    mockInvoke.mockRejectedValueOnce({ kind: 'Unauthorized' });
    renderStep();
    fireEvent.click(screen.getByTestId('test-vision-claude-sonnet-4-5'));
    await waitFor(() => expect(screen.getByTestId('models-error')).toBeInTheDocument());
    expect(screen.getByTestId('vision-claude-sonnet-4-5')).toHaveTextContent('Ve imágenes');
  });
});
