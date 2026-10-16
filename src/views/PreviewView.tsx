import React from 'react';
import { useParams } from 'react-router-dom';
import { PreviewPanel } from '../components/PreviewPanel/PreviewPanel';

export function PreviewView() {
  const { encodedPath } = useParams<{ encodedPath: string }>();
  const filePath = encodedPath ? decodeURIComponent(encodedPath) : '';

  return <PreviewPanel filePath={filePath} />;
}
