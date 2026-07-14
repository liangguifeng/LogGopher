/** Exercises connection, workspace, preference, and query flows through mocked Wails bindings. */
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import App from './App';

const api=vi.hoisted(()=>({
  Bootstrap:vi.fn(),
  Connect:vi.fn(),
  ConnectSaved:vi.fn(),
  DeleteProfile:vi.fn(),
  GetProfileCredentials:vi.fn(),
  Query:vi.fn(),
  QueryHistory:vi.fn(),
  SaveSettings:vi.fn(),
  UpdateProfile:vi.fn(),
}));

vi.mock('../../wailsjs/go/main/App',()=>api);
vi.mock('../../wailsjs/runtime/runtime',()=>({
  Environment:vi.fn().mockResolvedValue({platform:'darwin',arch:'arm64',buildType:'dev'}),
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
    api.ConnectSaved.mockResolvedValue({profileId:7,groups:[{name:'us-east-1',logstores:['application','audit']}]});
    api.Query.mockResolvedValue({tookMs:1,total:0,entries:[],histogram:[]});
    api.QueryHistory.mockResolvedValue([]);
    api.GetProfileCredentials.mockResolvedValue({accessKey:'saved-access',secretKey:'saved-secret'});
    api.SaveSettings.mockResolvedValue(undefined);
    api.UpdateProfile.mockResolvedValue(undefined);
    api.DeleteProfile.mockResolvedValue(undefined);
  });

  it('centers the application title in the macOS draggable titlebar',async()=>{
    render(<App/>);
    const title=await screen.findByText('LogGopher',{selector:'.window-titlebar span'});
    expect(title.closest('.window-titlebar')).toHaveAttribute('data-wails-drag');
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
    expect(screen.getByRole('navigation',{name:'日志库'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'切换配置'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'退出当前配置'})).toBeInTheDocument();
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

  it('opens preferences as a standalone page and returns to connection management',async()=>{
    const user=userEvent.setup();
    render(<App/>);

    await user.click(await screen.findByRole('button',{name:'偏好设置'}));
    expect(screen.getByRole('heading',{name:'偏好设置'})).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button',{name:'暗色'}));
    await user.click(screen.getByRole('button',{name:'保存设置'}));
    await waitFor(()=>expect(api.SaveSettings).toHaveBeenCalledWith(expect.objectContaining({theme:'dark'})));
    expect(screen.getByRole('heading',{name:'偏好设置'})).toBeInTheDocument();

    await user.click(screen.getByRole('button',{name:'返回'}));
    expect(screen.getByRole('heading',{name:'连接管理'})).toBeInTheDocument();
  });

  it('shows a spinner while connecting a saved profile',async()=>{
    const user=userEvent.setup();
    const profile={
      id:7,adapterId:'aws-cloudwatch',name:'AWS production',
      endpoint:'https://logs.us-east-1.amazonaws.com',project:'',region:'us-east-1',
    };
    let finishConnection:(session:{profileId:number;groups:{name:string;logstores:string[]}[]})=>void=()=>{};
    api.Bootstrap.mockResolvedValue({...bootstrap,profiles:[profile]});
    api.ConnectSaved.mockImplementation(()=>new Promise(resolve=>{finishConnection=resolve;}));
    render(<App/>);

    const connectButton=await screen.findByRole('button',{name:'连接'});
    await user.click(connectButton);
    const loadingButton=screen.getByRole('button',{name:'正在连接…'});
    expect(loadingButton).toBeDisabled();
    expect(loadingButton.querySelector('.button-spinner')).toBeInTheDocument();

    finishConnection({profileId:7,groups:[{name:'us-east-1',logstores:['application']}]});
    await waitFor(()=>expect(screen.getByRole('navigation',{name:'日志库'})).toBeInTheDocument());
  });

  it('uses an SLS full-text term when a clicked JSON path has no field index',async()=>{
    const user=userEvent.setup();
    const profile={
      id:7,adapterId:'aliyun-sls',name:'SLS production',
      endpoint:'https://cn-hangzhou.log.aliyuncs.com',project:'',region:'',
    };
    api.Bootstrap.mockResolvedValue({...bootstrap,profiles:[profile]});
    api.ConnectSaved.mockResolvedValue({profileId:7,groups:[{name:'project-a',logstores:['application']}]});
    api.Query.mockResolvedValue({
      tookMs:1,total:1,histogram:[],indexedFields:[],fullTextIndex:true,
      entries:[{
        time:'2026-07-12T09:30:56.806Z',level:'WARN',
        message:JSON.stringify({level_name:'WARN',message:'upstream slow'}),messageField:'content',fields:{},
      }],
    });
    render(<App/>);

    await user.click(await screen.findByRole('button',{name:'连接'}));
    await user.click(await screen.findByRole('button',{name:'"WARN"'}));
    await user.click(screen.getByRole('menuitem',{name:/加入筛选/}));

    await waitFor(()=>expect(api.Query).toHaveBeenLastCalledWith(expect.objectContaining({
      group:'project-a',logstore:'application',
      query:"* and WARN",
    })));
    expect(screen.getByPlaceholderText('输入查询语句、SQL、SPL'))
      .toHaveValue("* and WARN");
  });

  it('replaces a manually entered unindexed SLS field query with full text',async()=>{
    const user=userEvent.setup();
    const profile={
      id:7,adapterId:'aliyun-sls',name:'SLS production',
      endpoint:'https://cn-hangzhou.log.aliyuncs.com',project:'',region:'',
    };
    const effective="* not business";
    api.Bootstrap.mockResolvedValue({...bootstrap,profiles:[profile]});
    api.ConnectSaved.mockResolvedValue({profileId:7,groups:[{name:'project-a',logstores:['application']}]});
    api.Query.mockImplementation((input:{query:string})=>Promise.resolve({
      tookMs:1,total:0,entries:[],histogram:[],indexedFields:[],fullTextIndex:true,
      effectiveQuery:input.query ? effective : '',
    }));
    render(<App/>);

    await user.click(await screen.findByRole('button',{name:'连接'}));
    const editor=await screen.findByPlaceholderText('输入查询语句、SQL、SPL');
    await user.type(editor,'* not content.type: business{Enter}');

    await waitFor(()=>expect(editor).toHaveValue(effective));
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

    expect(await screen.findAllByText('AWS production')).toHaveLength(2);
    expect(document.querySelector('.saved-profile-tools > span')).toBeNull();
    expect(document.querySelector('.connection-tabs button > span')).toBeNull();

    await user.click(screen.getByRole('button',{name:'修改配置 AWS production'}));
    await waitFor(()=>expect(api.GetProfileCredentials).toHaveBeenCalledWith(7));
    const alias=screen.getByPlaceholderText('例如：杭州生产环境');
    expect(alias).toHaveValue('AWS production');
    expect(screen.getByLabelText('Access Key')).toHaveValue('saved-access');
    const secret=screen.getByLabelText('Secret Key');
    expect(secret).toHaveAttribute('type','password');
    expect(secret).toHaveValue('saved-secret');
    await user.click(screen.getByRole('button',{name:'显示 Secret Key'}));
    expect(secret).toHaveAttribute('type','text');
    expect(screen.getByRole('button',{name:'隐藏 Secret Key'})).toHaveAttribute('aria-pressed','true');
    await user.clear(alias);
    await user.type(alias,'AWS renamed');
    await user.click(screen.getByRole('button',{name:'保存修改'}));
    await waitFor(()=>expect(api.UpdateProfile).toHaveBeenCalledWith(7,expect.objectContaining({
      name:'AWS renamed',accessKey:'saved-access',secretKey:'saved-secret',region:'us-east-1',
    })));

    await user.click(await screen.findByRole('button',{name:'删除配置 AWS renamed'}));
    expect(screen.getByRole('dialog',{name:'删除连接配置'})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'确认删除'}));
    await waitFor(()=>expect(api.DeleteProfile).toHaveBeenCalledWith(7));
    expect(await screen.findByText('日志平台')).toBeInTheDocument();
  });
});
