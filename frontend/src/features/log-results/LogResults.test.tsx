import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,expect,it,vi} from 'vitest';
import LogResults,{parseEmbeddedJSON,resolveIndexedQueryField,type LogEntry} from './LogResults';

vi.mock('../../../wailsjs/runtime/runtime',()=>({ClipboardSetText:vi.fn().mockResolvedValue(true)}));

const nestedMessage=JSON.stringify({
  message:'执行消费逻辑结束(无日志)',
  level_name:'INFO',
  context:{data:{content:{member_data:[{value:2,one_id:'602501175188964'}]}}},
});

const entry:LogEntry={
  time:'2026-07-12T09:30:56.806Z',
  level:'UNKNOWN',
  message:nestedMessage,
  fields:{'__source__':'kafka-logstash','__topic__':'log-prod-business'},
};

const contentEntry:LogEntry={...entry,messageField:'content'};

const renderResults=(scopeKey='1:project-a:business')=>render(<LogResults
  scopeKey={scopeKey}
  entries={[entry]}
  total={1}
  locale="zh-CN"
  page={1}
  pageSize={20}
  onPageChange={vi.fn()}
  onPageSizeChange={vi.fn()}
  onFilter={vi.fn()}
/>);

describe('parseEmbeddedJSON',()=>{
  it('recursively parses JSON strings while preserving ordinary text',()=>{
    const value=parseEmbeddedJSON(JSON.stringify({nested:JSON.stringify([{ok:true}]),plain:'hello'})) as any;
    expect(value.nested[0].ok).toBe(true);
    expect(value.plain).toBe('hello');
    expect(parseEmbeddedJSON('{broken')).toBe('{broken');
  });

  it('stops parsing at the safety depth limit',()=>{
    let value:unknown='leaf';
    for(let index=0;index<14;index++)value=JSON.stringify({value});
    expect(JSON.stringify(parseEmbeddedJSON(value))).toContain('\\"value\\"');
  });

  it('resolves nested message values to the closest indexed SLS field',()=>{
    expect(resolveIndexedQueryField('message.level_name',new Set(['message']))).toBe('message');
    expect(resolveIndexedQueryField('message.context.result',new Set(['message','message.context']))).toBe('message.context');
    expect(resolveIndexedQueryField('message.level_name',new Set(['other']))).toBeUndefined();
  });
});

describe('LogResults JSON tree',()=>{
  it('opens two levels by default and adjusts depth for only the active scope',async()=>{
    const user=userEvent.setup();
    const view=renderResults();
    expect(screen.getByText('context:')).toBeInTheDocument();
    expect(screen.queryByText('member_data:')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button',{name:'JSON 展开设置'}));
    await user.click(screen.getByRole('button',{name:'＋'}));
    expect(await screen.findByText('member_data:')).toBeInTheDocument();

    view.rerender(<LogResults scopeKey="1:project-a:other" entries={[entry]} total={1} locale="zh-CN" page={1} pageSize={20} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} onFilter={vi.fn()}/>);
    expect(screen.queryByText('member_data:')).not.toBeInTheDocument();
    view.rerender(<LogResults scopeKey="1:project-a:business" entries={[entry]} total={1} locale="zh-CN" page={1} pageSize={20} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} onFilter={vi.fn()}/>);
    await waitFor(()=>expect(screen.getByText('member_data:')).toBeInTheDocument());
  });

  it('paginates, switches views and emits filter actions',async()=>{
    const onPageChange=vi.fn();
    const onFilter=vi.fn();
    render(<LogResults scopeKey="scope" entries={[entry]} total={45} locale="zh-CN" page={1} pageSize={20} onPageChange={onPageChange} onPageSizeChange={vi.fn()} onFilter={onFilter}/>);
    await userEvent.click(screen.getByRole('button',{name:'2'}));
    expect(onPageChange).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByRole('button',{name:'表格'}));
    expect(screen.getByRole('columnheader',{name:'MESSAGE'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'原始'}));
    fireEvent.click(screen.getByRole('button',{name:'"执行消费逻辑结束(无日志)"'}));
    await userEvent.click(screen.getByRole('menuitem',{name:/加入筛选/}));
    expect(onFilter).toHaveBeenCalledWith('message.message','message.message','执行消费逻辑结束(无日志)',false);
  });

  it('keeps filter actions available for unindexed SLS values',async()=>{
    const onFilter=vi.fn();
    render(<LogResults scopeKey="scope" entries={[entry]} total={1} locale="zh-CN" page={1} pageSize={20} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} onFilter={onFilter} filterableFields={['message.level_name']}/>);
    expect(screen.queryByText('level:',{selector:'.json-key'})).not.toBeInTheDocument();
    expect(screen.getByText('"执行消费逻辑结束(无日志)"')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'"执行消费逻辑结束(无日志)"'}));
    expect(screen.getByRole('button',{name:'复制'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem',{name:/加入筛选/}));
    expect(onFilter).toHaveBeenCalledWith(undefined,'message.message','执行消费逻辑结束(无日志)',false);
    expect(screen.getByRole('button',{name:'"INFO"'})).toBeInTheDocument();
  });

  it('filters nested message content through an indexed message parent',async()=>{
    const onFilter=vi.fn();
    render(<LogResults scopeKey="scope" entries={[entry]} total={1} locale="zh-CN" page={1} pageSize={20} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} onFilter={onFilter} filterableFields={['message']}/>);
    await userEvent.click(screen.getByRole('button',{name:'"执行消费逻辑结束(无日志)"'}));
    await userEvent.click(screen.getByRole('menuitem',{name:/加入筛选/}));
    expect(onFilter).toHaveBeenCalledWith('message','message.message','执行消费逻辑结束(无日志)',false);
  });

  it('uses an explicitly configured SLS JSON leaf index',async()=>{
    const onFilter=vi.fn();
    render(<LogResults scopeKey="scope" entries={[entry]} total={1} locale="zh-CN" page={1} pageSize={20} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} onFilter={onFilter} filterableFields={['message.level_name']}/>);
    await userEvent.click(screen.getByRole('button',{name:'"INFO"'}));
    await userEvent.click(screen.getByRole('menuitem',{name:/加入筛选/}));
    expect(onFilter).toHaveBeenCalledWith('message.level_name','message.level_name','INFO',false);
  });

  it('retains the original SLS content field in a displayed JSON query path',async()=>{
    const onFilter=vi.fn();
    render(<LogResults scopeKey="scope" entries={[contentEntry]} total={1} locale="zh-CN" page={1} pageSize={20} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} onFilter={onFilter} filterableFields={['content.level_name']}/>);
    await userEvent.click(screen.getByRole('button',{name:'"INFO"'}));
    await userEvent.click(screen.getByRole('menuitem',{name:/加入筛选/}));
    expect(onFilter).toHaveBeenCalledWith('content.level_name','content.level_name','INFO',false);
  });
});
