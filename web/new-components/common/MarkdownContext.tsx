import markdownComponents, { markdownPlugins, preprocessLaTeX } from '@/components/chat/chat-content/config';
import { GPTVis } from '@antv/gpt-vis';
import React from 'react';

type MarkdownComponents = Parameters<typeof GPTVis>[0]['components'];

const MarkDownContext: React.FC<{ children: string; components?: Record<string, React.ElementType> }> = ({
  children,
  components,
}) => {
  return (
    <GPTVis components={{ ...markdownComponents, ...components } as MarkdownComponents} {...markdownPlugins}>
      {preprocessLaTeX(children)}
    </GPTVis>
  );
};

export default MarkDownContext;
