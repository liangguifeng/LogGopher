import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,expect,it,vi} from 'vitest';
import DateTimeField from './DateTimeField';

describe('DateTimeField',()=>{
  it('opens the calendar, navigates months and updates time',async()=>{
    const user=userEvent.setup();
    const onChange=vi.fn();
    render(<DateTimeField label="开始时间" value="2026-07-12T09:30:00.000Z" locale="zh-CN" onChange={onChange}/>);
    await user.click(screen.getByRole('button',{name:/2026-07-12/}));
    expect(screen.getByRole('dialog',{name:'开始时间'})).toBeInTheDocument();
    const heading=screen.getByText(/2026年7月/);
    expect(heading).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'下个月'}));
    expect(screen.getByText(/2026年8月/)).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'增加小时'}));
    expect(onChange).toHaveBeenCalled();
  });

  it('closes when focus leaves the component',async()=>{
    render(<><DateTimeField label="结束时间" value="2026-07-12T10:30:00.000Z" locale="zh-CN" onChange={vi.fn()}/><button>outside</button></>);
    await userEvent.click(screen.getByRole('button',{name:/2026-07-12/}));
    await userEvent.click(screen.getByRole('button',{name:'outside'}));
    expect(screen.queryByRole('dialog',{name:'结束时间'})).not.toBeInTheDocument();
  });
});
