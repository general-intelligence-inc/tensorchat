declare module 'react-native-enriched-markdown' {
  import type { ComponentType } from 'react';
  import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

  type TextAlign = 'auto' | 'left' | 'right' | 'center' | 'justify';

  interface BaseBlockStyle {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string;
    color?: string;
    marginTop?: number;
    marginBottom?: number;
    lineHeight?: number;
  }

  interface ParagraphStyle extends BaseBlockStyle {
    textAlign?: TextAlign;
  }

  interface HeadingStyle extends BaseBlockStyle {
    textAlign?: TextAlign;
  }

  interface BlockquoteStyle extends BaseBlockStyle {
    borderColor?: string;
    borderWidth?: number;
    gapWidth?: number;
    backgroundColor?: string;
  }

  interface ListStyle extends BaseBlockStyle {
    bulletColor?: string;
    bulletSize?: number;
    markerColor?: string;
    markerFontWeight?: string;
    gapWidth?: number;
    marginLeft?: number;
  }

  interface CodeBlockStyle extends BaseBlockStyle {
    backgroundColor?: string;
    borderColor?: string;
    borderRadius?: number;
    borderWidth?: number;
    padding?: number;
  }

  interface LinkStyle {
    fontFamily?: string;
    color?: string;
    underline?: boolean;
  }

  interface StrongStyle {
    fontFamily?: string;
    fontWeight?: string;
    color?: string;
  }

  interface EmphasisStyle {
    fontFamily?: string;
    fontStyle?: string;
    color?: string;
  }

  interface StrikethroughStyle {
    color?: string;
  }

  interface UnderlineStyle {
    color?: string;
  }

  interface CodeStyle {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    backgroundColor?: string;
    borderColor?: string;
  }

  interface ImageStyle {
    height?: number;
    borderRadius?: number;
    marginTop?: number;
    marginBottom?: number;
  }

  interface InlineImageStyle {
    size?: number;
  }

  interface ThematicBreakStyle {
    color?: string;
    height?: number;
    marginTop?: number;
    marginBottom?: number;
  }

  interface TableStyle extends BaseBlockStyle {
    headerFontFamily?: string;
    headerBackgroundColor?: string;
    headerTextColor?: string;
    rowEvenBackgroundColor?: string;
    rowOddBackgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
    cellPaddingHorizontal?: number;
    cellPaddingVertical?: number;
  }

  interface TaskListStyle {
    checkedColor?: string;
    borderColor?: string;
    checkboxSize?: number;
    checkboxBorderRadius?: number;
    checkmarkColor?: string;
    checkedTextColor?: string;
    checkedStrikethrough?: boolean;
  }

  interface MathStyle {
    fontSize?: number;
    color?: string;
    backgroundColor?: string;
    padding?: number;
    marginTop?: number;
    marginBottom?: number;
    textAlign?: 'left' | 'center' | 'right';
  }

  interface InlineMathStyle {
    color?: string;
  }

  export interface MarkdownStyle {
    paragraph?: ParagraphStyle;
    h1?: HeadingStyle;
    h2?: HeadingStyle;
    h3?: HeadingStyle;
    h4?: HeadingStyle;
    h5?: HeadingStyle;
    h6?: HeadingStyle;
    blockquote?: BlockquoteStyle;
    list?: ListStyle;
    codeBlock?: CodeBlockStyle;
    link?: LinkStyle;
    strong?: StrongStyle;
    em?: EmphasisStyle;
    strikethrough?: StrikethroughStyle;
    underline?: UnderlineStyle;
    code?: CodeStyle;
    image?: ImageStyle;
    inlineImage?: InlineImageStyle;
    thematicBreak?: ThematicBreakStyle;
    table?: TableStyle;
    taskList?: TaskListStyle;
    math?: MathStyle;
    inlineMath?: InlineMathStyle;
  }

  export interface Md4cFlags {
    underline?: boolean;
    latexMath?: boolean;
  }

  export interface LinkPressEvent {
    url: string;
  }

  export interface LinkLongPressEvent {
    url: string;
  }

  export interface TaskListItemPressEvent {
    index: number;
    checked: boolean;
    text: string;
  }

  export interface EnrichedMarkdownTextProps {
    markdown: string;
    markdownStyle?: MarkdownStyle;
    containerStyle?: StyleProp<ViewStyle | TextStyle>;
    onLinkPress?: (event: LinkPressEvent) => void;
    onLinkLongPress?: (event: LinkLongPressEvent) => void;
    onTaskListItemPress?: (event: TaskListItemPressEvent) => void;
    enableLinkPreview?: boolean;
    selectable?: boolean;
    md4cFlags?: Md4cFlags;
    allowFontScaling?: boolean;
    maxFontSizeMultiplier?: number;
    allowTrailingMargin?: boolean;
    flavor?: 'commonmark' | 'github';
    streamingAnimation?: boolean;
  }

  export const EnrichedMarkdownText: ComponentType<EnrichedMarkdownTextProps>;
  export default EnrichedMarkdownText;
}