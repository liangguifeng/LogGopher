import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import App from './App';

const api=vi.hoisted(()=>({
  Bootstrap:vi.fn(),
  Connect:vi.fn(),
  ConnectSaved:vi.fn(),
  DeleteProfile:vi.fn(),
  Query:vi.fn(),
  QueryHistory:vi.fn(),
  SaveSettings:vi.fn(),
  UpdateProfile:vi.fn(),
}));

vi.mock('../../wailsjs/go/main/App',()=>api);
vi.mock('../../wailsjs/runtime/runtime',()=>({
  EventsOn:vi.fn(()=>vi.fn()),
  ClipboardSetText:vi.fn().mockResolvedValue(true),
}));

const bootstrap={
  adapters:[
    {id:'aliyun-sls',name:'阿里云 SLS',description:'Simple Log Service',ready:true},
    {id:'tencent-cls',name:'腾讯云 CLS',description:'Cloud Log Service',ready:true},
    {id:'aws-cloudwatch',name:'AWS CloudWatch',description:'CloudWatch Logs',ready:true},
  ],
  profiles:[],
  settings:{theme:'system',language:'zh-CN',density:'comfortable'},
};

describe('App connection workflow',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    api.Bootstrap.mockResolvedValue(bootstrap);
    api.Connect.mockResolvedValue({profileId:7,groups:[{name:'us-east-1',logstores:['application','audit']}]});
    api.Query.mockResolvedValue({tookMs:1,total:0,entries:[],histogram:[]});
    api.QueryHistory.mockResolvedValue([]);
    api.SaveSettings.mockResolvedValue(undefined);
    api.UpdateProfile.mockResolvedValue(undefined);
    api.DeleteProfile.mockResolvedValue(undefined);
  });

  it('selects AWS with the custom platform picker and submits its region',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole('button',{name:/阿里云 SLS/}));
    await user.click(screen.getByRole('option',{name:/AWS CloudWatch/}));
    expect(screen.getByPlaceholderText('https://logs.us-east-1.amazonaws.com')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('例如：杭州生产环境'), 'AWS production');
    await user.type(screen.getByPlaceholderText('https://logs.us-east-1.amazonaws.com'),'https://logs.us-east-1.amazonaws.com');
    const inputs=screen.getAllByRole('textbox');
    await user.type(inputs.find(input=>input.getAttribute('autocomplete')==='off')!,'access-key');
    await user.type(screen.getByPlaceholderText('us-east-1'),'us-east-1');
    const password=document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(password,'secret-key');
    await user.click(screen.getByRole('button',{name:'保存并连接'}));

    await waitFor(()=>expect(api.Connect).toHaveBeenCalledWith(expect.objectContaining({
      adapterId:'aws-cloudwatch',name:'AWS production',region:'us-east-1',
    })));

    const editor=await screen.findByPlaceholderText('输入查询语句、SQL、SPL');
    await user.type(editor,'level:error');
    await user.click(screen.getByRole('button',{name:/audit/}));
    expect(editor).toHaveValue('');
    await waitFor(()=>expect(api.Query).toHaveBeenLastCalledWith(expect.objectContaining({
      group:'us-east-1',logstore:'audit',query:'',
    })));
  });

  it('applies the configured language and theme from bootstrap',async()=>{
    api.Bootstrap.mockResolvedValue({...bootstrap,settings:{theme:'dark',language:'en-US',density:'compact'}});
    render(<App/>);
    expect(await screen.findByText('Log platform')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.density).toBe('compact');
  });

  it('edits and deletes saved profiles without showing list counts',async()=>{
    const user=userEvent.setup();
    const profile={
      id:7,adapterId:'aws-cloudwatch',name:'AWS production',
      endpoint:'https://logs.us-east-1.amazonaws.com',project:'',region:'us-east-1',
    };
    api.Bootstrap
      .mockResolvedValueOnce({...bootstrap,profiles:[profile]})
      .mockResolvedValueOnce({...bootstrap,profiles:[{...profile,name:'AWS renamed'}]})
      .mockResolvedValueOnce({...bootstrap,profiles:[]});
    render(<App/>);

    expect(await screen.findByText('AWS production')).toBeInTheDocument();
    expect(document.querySelector('.saved-profile-tools > span')).toBeNull();
    expect(document.querySelector('.connection-tabs button > span')).toBeNull();

    await user.click(screen.getByRole('button',{name:'修改配置 AWS production'}));
    const alias=screen.getByPlaceholderText('例如：杭州生产环境');
    expect(alias).toHaveValue('AWS production');
    expect(screen.getAllByPlaceholderText('留空则保留原凭证')).toHaveLength(2);
    await user.clear(alias);
    await user.type(alias,'AWS renamed');
    await user.click(screen.getByRole('button',{name:'保存修改'}));
    await waitFor(()=>expect(api.UpdateProfile).toHaveBeenCalledWith(7,expect.objectContaining({
      name:'AWS renamed',accessKey:'',secretKey:'',region:'us-east-1',
    })));

    await user.click(await screen.findByRole('button',{name:'删除配置 AWS renamed'}));
    expect(screen.getByRole('dialog',{name:'删除连接配置'})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'确认删除'}));
    await waitFor(()=>expect(api.DeleteProfile).toHaveBeenCalledWith(7));
    expect(await screen.findByText('日志平台')).toBeInTheDocument();
  });
});
